#pragma once
#include <windows.h>
#include <commctrl.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <shellscalingapi.h>
#include <wincodec.h>
#include <wincrypt.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Data.Json.h>
#include <filesystem>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace desktop {
namespace fs = std::filesystem;
using winrt::check_bool;
using winrt::check_hresult;
using winrt::com_ptr;
using winrt::hstring;
using winrt::Windows::Data::Json::IJsonValue;
using winrt::Windows::Data::Json::JsonArray;
using winrt::Windows::Data::Json::JsonObject;
using winrt::Windows::Data::Json::JsonValue;

inline constexpr wchar_t product[] = L"Mineradio 桌面歌词";
inline constexpr UINT pipeLine = WM_APP + 1;
inline constexpr UINT pipeClosed = WM_APP + 2;

inline JsonObject event(hstring name) {
    JsonObject message;
    message.SetNamedValue(L"event", JsonValue::CreateStringValue(name));
    return message;
}

inline fs::path knownFolder(REFKNOWNFOLDERID id) {
    PWSTR raw = nullptr;
    check_hresult(SHGetKnownFolderPath(id, 0, nullptr, &raw));
    std::unique_ptr<wchar_t, decltype(&CoTaskMemFree)> value(raw, CoTaskMemFree);
    return value.get();
}

inline fs::path userFolder(const wchar_t* variable, REFKNOWNFOLDERID id) {
    const DWORD size = GetEnvironmentVariableW(variable, nullptr, 0);
    if (!size) return knownFolder(id);
    std::wstring path(size, L'\0');
    path.resize(GetEnvironmentVariableW(variable, path.data(), size));
    return path;
}

inline fs::path executable() {
    std::wstring path(32768, L'\0');
    const auto length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    check_bool(length && length < path.size());
    path.resize(length);
    return path;
}

inline std::wstring quote(const std::wstring_view value) {
    // CommandLineToArgvW: double a run of slashes before a quote or the closing quote.
    std::wstring quoted(1, L'"');
    size_t slashes = 0;
    for (const wchar_t ch : value) {
        if (ch == L'\\') {
            ++slashes;
            continue;
        }
        quoted.append(ch == L'"' ? slashes * 2 + 1 : slashes, L'\\');
        quoted += ch;
        slashes = 0;
    }
    quoted.append(slashes * 2, L'\\');
    quoted += L'"';
    return quoted;
}

class Backend {
public:
    void start(HWND host, const fs::path& exe, const fs::path& scripts,
               const fs::path& logDirectory, const std::vector<std::wstring>& args) {
        SECURITY_ATTRIBUTES inheritable{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
        winrt::handle inputRead, outputWrite;
        check_bool(CreatePipe(inputRead.put(), input_.put(), &inheritable, 0));
        check_bool(CreatePipe(output_.put(), outputWrite.put(), &inheritable, 0));
        check_bool(SetHandleInformation(input_.get(), HANDLE_FLAG_INHERIT, 0));
        check_bool(SetHandleInformation(output_.get(), HANDLE_FLAG_INHERIT, 0));

        fs::create_directories(logDirectory);
        const auto errorFile = CreateFileW((logDirectory / L"backend-stderr.log").c_str(),
            GENERIC_WRITE, FILE_SHARE_READ, &inheritable, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        check_bool(errorFile != INVALID_HANDLE_VALUE);
        winrt::handle errors(errorFile);

        STARTUPINFOW startup{sizeof(STARTUPINFOW)};
        startup.dwFlags = STARTF_USESTDHANDLES;
        startup.hStdInput = inputRead.get();
        startup.hStdOutput = outputWrite.get();
        startup.hStdError = errors.get();

        const auto node = exe.parent_path() / L"resources/node.exe";
        auto command = quote(node.native()) + L" --no-global-search-paths " +
            quote((scripts / L"src/desktop-main.cjs").native());
        for (const auto& arg : args) command += L" " + quote(arg);

        check_bool(SetEnvironmentVariableW(L"MINERADIO_DESKTOP_EXE", exe.c_str()));
        PROCESS_INFORMATION process{};
        check_bool(CreateProcessW(node.c_str(), command.data(), nullptr, nullptr, TRUE,
            CREATE_NO_WINDOW, nullptr, exe.parent_path().c_str(), &startup, &process));
        process_.attach(process.hProcess);
        CloseHandle(process.hThread);
        inputRead.close();
        outputWrite.close();

        reader_ = std::thread([this, host] {
            std::string pending;
            char chunk[8192];
            DWORD length;
            while (ReadFile(output_.get(), chunk, sizeof(chunk), &length, nullptr) && length) {
                pending.append(chunk, length);
                size_t start = 0;
                for (auto end = pending.find('\n'); end != std::string::npos; end = pending.find('\n', start)) {
                    auto line = std::make_unique<std::string>(pending, start, end - start);
                    if (!PostMessageW(host, pipeLine, 0, reinterpret_cast<LPARAM>(line.get()))) return;
                    line.release();
                    start = end + 1;
                }
                pending.erase(0, start);
            }
            PostMessageW(host, pipeClosed, 0, 0);
        });
    }

    void send(const JsonObject& message) const {
        auto data = winrt::to_string(message.Stringify());
        data += '\n';
        DWORD written;
        if (!WriteFile(input_.get(), data.data(), static_cast<DWORD>(data.size()), &written, nullptr) &&
            GetLastError() != ERROR_BROKEN_PIPE && GetLastError() != ERROR_NO_DATA)
            winrt::throw_last_error();
    }

    DWORD exitCode() const {
        WaitForSingleObject(process_.get(), 3000);
        DWORD code;
        check_bool(GetExitCodeProcess(process_.get(), &code));
        return code;
    }

    ~Backend() {
        input_.close();
        if (reader_.joinable()) {
            CancelSynchronousIo(reader_.native_handle());
            reader_.join();
        }
    }

private:
    winrt::handle process_, input_, output_;
    std::thread reader_;
};

struct Monitor {
    RECT physical;
    RECT work;
    UINT dpi;
};

inline Monitor monitor(HMONITOR handle) {
    MONITORINFO info{sizeof(MONITORINFO)};
    check_bool(GetMonitorInfoW(handle, &info));
    UINT x, y;
    check_hresult(GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, &x, &y));
    return {info.rcMonitor, info.rcWork, x};
}

inline JsonObject logicalBounds(RECT rect, const Monitor& display) {
    const auto originX = display.physical.left;
    const auto originY = display.physical.top;
    JsonObject result;
    result.SetNamedValue(L"x", JsonValue::CreateNumberValue(originX + MulDiv(rect.left - originX, 96, display.dpi)));
    result.SetNamedValue(L"y", JsonValue::CreateNumberValue(originY + MulDiv(rect.top - originY, 96, display.dpi)));
    result.SetNamedValue(L"width", JsonValue::CreateNumberValue(MulDiv(rect.right - rect.left, 96, display.dpi)));
    result.SetNamedValue(L"height", JsonValue::CreateNumberValue(MulDiv(rect.bottom - rect.top, 96, display.dpi)));
    return result;
}

inline JsonArray workAreas() {
    JsonArray other;
    EnumDisplayMonitors(nullptr, nullptr, [](HMONITOR handle, HDC, LPRECT, LPARAM arg) -> BOOL {
        const auto display = monitor(handle);
        if (display.physical.left || display.physical.top)
            reinterpret_cast<JsonArray*>(arg)->Append(logicalBounds(display.work, display));
        return TRUE;
    }, reinterpret_cast<LPARAM>(&other));
    const auto primary = monitor(MonitorFromPoint({0, 0}, MONITOR_DEFAULTTOPRIMARY));
    JsonArray result;
    result.Append(logicalBounds(primary.work, primary));
    for (const auto& area : other) result.Append(area);
    return result;
}

inline int ask(HWND owner, JsonObject const& options) {
    const auto title = options.GetNamedString(L"title");
    const auto firstLine = options.GetNamedString(L"message");
    const auto detail = options.GetNamedString(L"detail", L"");
    const auto type = options.GetNamedString(L"type", L"info");
    const auto labels = options.GetNamedArray(L"buttons", JsonArray{});
    const auto cancel = static_cast<int>(options.GetNamedNumber(L"cancelId", labels.Size() ? labels.Size() - 1 : 0));
    const auto defaultId = static_cast<int>(options.GetNamedNumber(L"defaultId", 0));
    std::vector<hstring> text;
    for (const auto& label : labels) text.push_back(label.GetString());

    std::vector<TASKDIALOG_BUTTON> buttons;
    for (int i = 0; i < static_cast<int>(text.size()); ++i)
        buttons.push_back({100 + i, text[i].c_str()});

    TASKDIALOGCONFIG task{sizeof(TASKDIALOGCONFIG)};
    task.hwndParent = owner;
    task.dwFlags = TDF_ALLOW_DIALOG_CANCELLATION | TDF_POSITION_RELATIVE_TO_WINDOW;
    task.dwCommonButtons = buttons.empty() ? TDCBF_OK_BUTTON : 0;
    task.pszWindowTitle = title.c_str();
    task.pszMainInstruction = firstLine.c_str();
    task.pszContent = detail.c_str();
    task.pszMainIcon = type == L"error" ? TD_ERROR_ICON : type == L"warning" ? TD_WARNING_ICON : TD_INFORMATION_ICON;
    task.pButtons = buttons.data();
    task.cButtons = static_cast<UINT>(buttons.size());
    task.nDefaultButton = 100 + defaultId;
    int button = 0;
    check_hresult(TaskDialogIndirect(&task, &button, nullptr, nullptr));
    return button >= 100 ? button - 100 : cancel;
}

inline JsonObject choosePath(HWND owner, JsonObject const& options) {
    com_ptr<IFileOpenDialog> picker;
    check_hresult(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(picker.put())));
    const auto title = options.GetNamedString(L"title");
    check_hresult(picker->SetTitle(title.c_str()));
    FILEOPENDIALOGOPTIONS flags;
    check_hresult(picker->GetOptions(&flags));
    flags |= FOS_FORCEFILESYSTEM;
    if (options.GetNamedArray(L"properties").GetStringAt(0) == L"openDirectory") {
        flags |= FOS_PICKFOLDERS | FOS_PATHMUSTEXIST;
    } else {
        COMDLG_FILTERSPEC filter{L"网易云程序 (*.exe)", L"*.exe"};
        check_hresult(picker->SetFileTypes(1, &filter));
        flags |= FOS_FILEMUSTEXIST;
    }
    check_hresult(picker->SetOptions(flags));

    const auto initial = options.GetNamedString(L"defaultPath", L"");
    if (!initial.empty()) {
        fs::path folder(initial.c_str());
        if (!(flags & FOS_PICKFOLDERS)) folder = folder.parent_path();
        com_ptr<IShellItem> item;
        if (SUCCEEDED(SHCreateItemFromParsingName(folder.c_str(), nullptr, IID_PPV_ARGS(item.put()))))
            picker->SetFolder(item.get());
    }

    const auto result = picker->Show(owner);
    const auto canceled = result == HRESULT_FROM_WIN32(ERROR_CANCELLED);
    JsonArray paths;
    if (!canceled) {
        check_hresult(result);
        com_ptr<IShellItem> item;
        check_hresult(picker->GetResult(item.put()));
        PWSTR raw = nullptr;
        check_hresult(item->GetDisplayName(SIGDN_FILESYSPATH, &raw));
        std::unique_ptr<wchar_t, decltype(&CoTaskMemFree)> path(raw, CoTaskMemFree);
        paths.Append(JsonValue::CreateStringValue(path.get()));
    }
    JsonObject response;
    response.SetNamedValue(L"canceled", JsonValue::CreateBooleanValue(canceled));
    response.SetNamedValue(L"filePaths", paths);
    return response;
}

inline hstring decodeCover(const hstring& encoded) {
    DWORD length = 0;
    check_bool(CryptStringToBinaryW(encoded.c_str(), encoded.size(), CRYPT_STRING_BASE64, nullptr, &length, nullptr, nullptr));
    std::vector<BYTE> bytes(length);
    check_bool(CryptStringToBinaryW(encoded.c_str(), encoded.size(), CRYPT_STRING_BASE64, bytes.data(), &length, nullptr, nullptr));

    com_ptr<IWICImagingFactory> factory;
    check_hresult(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(factory.put())));
    com_ptr<IWICStream> stream;
    check_hresult(factory->CreateStream(stream.put()));
    check_hresult(stream->InitializeFromMemory(bytes.data(), length));
    com_ptr<IWICBitmapDecoder> decoder;
    check_hresult(factory->CreateDecoderFromStream(stream.get(), nullptr, WICDecodeMetadataCacheOnDemand, decoder.put()));
    com_ptr<IWICBitmapFrameDecode> frame;
    check_hresult(decoder->GetFrame(0, frame.put()));
    com_ptr<IWICBitmapScaler> scaled;
    check_hresult(factory->CreateBitmapScaler(scaled.put()));
    check_hresult(scaled->Initialize(frame.get(), 64, 64, WICBitmapInterpolationModeFant));
    com_ptr<IWICFormatConverter> bitmap;
    check_hresult(factory->CreateFormatConverter(bitmap.put()));
    check_hresult(bitmap->Initialize(scaled.get(), GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom));
    BYTE bgra[64 * 64 * 4];
    check_hresult(bitmap->CopyPixels(nullptr, 64 * 4, sizeof(bgra), bgra));

    constexpr auto format = CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF;
    check_bool(CryptBinaryToStringW(bgra, sizeof(bgra), format, nullptr, &length));
    std::wstring result(length, L'\0');
    check_bool(CryptBinaryToStringW(bgra, sizeof(bgra), format, result.data(), &length));
    return hstring(result.data(), length);
}
} // namespace desktop
