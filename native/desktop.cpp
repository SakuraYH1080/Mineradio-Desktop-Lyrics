#include "platform.h"
#include "fonts.h"
#include "identity.h"
#include <windowsx.h>
#include <dcomp.h>
#include <WebView2.h>
#include <wrl/event.h>
#include <algorithm>
#include <map>

namespace desktop {
using Microsoft::WRL::Callback;

constexpr wchar_t hostClass[] = L"Mineradio.Lyrics.Host";
constexpr wchar_t viewClass[] = L"Mineradio.Lyrics.View";
constexpr wchar_t origin[] = L"https://mineradio.invalid";
constexpr UINT trayMessage = WM_APP + 3;
constexpr UINT_PTR mouseTimer = 1;

class Host;

struct View {
    Host& host;
    int id;
    bool overlay;
    HWND window = nullptr;
    int minimumWidth = 0;
    int minimumHeight = 0;
    bool locked = false;
    bool lockedHover = false;
    bool middleDown = false;
    bool mouseTracked = false;
    bool loaded = false;
    POINT cursor{};
    RECT dragStart{}, dragHotBounds{};
    bool dragging = false;
    RECT hotBounds{};
    hstring uri;
    com_ptr<ICoreWebView2Controller> controller;
    com_ptr<ICoreWebView2CompositionController> visualController;
    com_ptr<ICoreWebView2> page;
    com_ptr<IDCompositionTarget> target;
    com_ptr<IDCompositionVisual> visual;

    View(Host& host, int id, bool overlay) : host(host), id(id), overlay(overlay) {}
    ~View() {
        if (controller) controller->Close();
        if (window) DestroyWindow(window);
    }
    void resize() const {
        if (!controller) return;
        RECT bounds;
        GetClientRect(window, &bounds);
        controller->put_Bounds(bounds);
    }
    void show(bool visible) {
        controller->put_IsVisible(visible);
        const int mode = overlay ? SW_SHOWNOACTIVATE : IsIconic(window) ? SW_RESTORE : SW_SHOW;
        ShowWindow(window, visible ? mode : SW_HIDE);
        if (overlay) {
            if (visible) SetTimer(window, mouseTimer, 24, nullptr);
            else {
                KillTimer(window, mouseTimer);
                setLockedHover(false);
            }
        }
    }
    void setLockedHover(bool inside) {
        if (lockedHover == inside) return;
        lockedHover = inside;
        JsonArray args;
        args.Append(JsonValue::CreateBooleanValue(inside));
        JsonObject message;
        message.SetNamedValue(L"channel", JsonValue::CreateStringValue(L"mineradio-desktop-lyrics-locked-hover"));
        message.SetNamedValue(L"args", args);
        page->PostWebMessageAsJson(message.Stringify().c_str());
    }
    void setLocked(bool value) {
        if (locked != value) setLockedHover(false);
        locked = value;
        dragging = false;
        if (locked && GetCapture() == window) ReleaseCapture();
        constexpr LONG_PTR passThrough = WS_EX_TRANSPARENT | WS_EX_LAYERED;
        const auto style = GetWindowLongPtrW(window, GWL_EXSTYLE);
        SetWindowLongPtrW(window, GWL_EXSTYLE, locked ? style | passThrough : style & ~passThrough);
        SetWindowPos(window, nullptr, 0, 0, 0, 0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }
    void beginDrag();
    void pollMouse();
    void sendBounds() const;
    LRESULT message(UINT message, WPARAM wParam, LPARAM lParam);
    static LRESULT CALLBACK procedure(HWND window, UINT message, WPARAM wParam, LPARAM lParam);
};

class Host {
public:
    explicit Host(HINSTANCE instance) :
        instance(instance), exe(executable()),
        scripts(exe.parent_path() / L"resources/app"),
        profile(userFolder(L"LOCALAPPDATA", FOLDERID_LocalAppData) / L"MineradioExternalLyrics/WebView2"),
        logs(userFolder(L"APPDATA", FOLDERID_RoamingAppData) / L"MineradioExternalLyrics/logs") {}

    int run(const std::vector<std::wstring>& args) {
        winrt::handle showEvent(CreateEventW(nullptr, FALSE, FALSE, L"Local\\" MINERADIO_APP_ID L".Show"));
        check_bool(static_cast<bool>(showEvent));
        winrt::handle mutex(CreateMutexW(nullptr, FALSE, L"Local\\" MINERADIO_APP_ID));
        const auto lockError = GetLastError();
        check_bool(static_cast<bool>(mutex));
        if (lockError == ERROR_ALREADY_EXISTS) {
            SetEvent(showEvent.get());
            return 0;
        }

        PWSTR availableVersion = nullptr;
        const auto runtime = GetAvailableCoreWebView2BrowserVersionString(nullptr, &availableVersion);
        if (FAILED(runtime) || !availableVersion) {
            if (MessageBoxW(nullptr, L"请安装 Microsoft Edge WebView2 Evergreen Runtime 后再启动。\n打开微软官方下载页？",
                    product, MB_YESNO | MB_ICONINFORMATION) == IDYES)
                ShellExecuteW(nullptr, L"open", L"https://developer.microsoft.com/microsoft-edge/webview2/#download", nullptr, nullptr, SW_SHOWNORMAL);
            return 1;
        }
        CoTaskMemFree(availableVersion);
        SetCurrentProcessExplicitAppUserModelID(MINERADIO_APP_ID);
        registerWindow(hostClass, &Host::procedure);
        registerWindow(viewClass, &View::procedure, CS_DBLCLKS);
        control = CreateWindowExW(WS_EX_TOOLWINDOW, hostClass, product, WS_POPUP,
            0, 0, 0, 0, nullptr, nullptr, instance, this);
        check_bool(control != nullptr);
        taskbarCreated = RegisterWindowMessageW(L"TaskbarCreated");
        tray.hWnd = control;
        tray.uID = 1;
        backend.start(control, exe, scripts, logs, args);
        sendDisplays(L"ready");

        const HANDLE show = showEvent.get();
        MSG message;
        while (true) {
            const DWORD wait = MsgWaitForMultipleObjects(1, &show, FALSE, INFINITE, QS_ALLINPUT);
            if (wait == WAIT_OBJECT_0 && !closing) send(event(L"second-instance"));
            if (wait == WAIT_FAILED) winrt::throw_last_error();
            while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
                if (message.message == WM_QUIT) {
                    views.clear();
                    removeTray();
                    DestroyWindow(control);
                    mutex.close();
                    if (!restart.empty()) relaunch();
                    return static_cast<int>(message.wParam);
                }
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }

    void send(const JsonObject& message) const {
        if (!closing) backend.send(message);
    }

    void closeView(int id) {
        views.erase(id);
        auto message = event(L"closed");
        message.SetNamedValue(L"window", JsonValue::CreateNumberValue(id));
        send(message);
    }

private:
    HINSTANCE instance;
    fs::path exe, scripts, profile, logs;
    HWND control = nullptr;
    NOTIFYICONDATAW tray{sizeof(NOTIFYICONDATAW)};
    UINT taskbarCreated = 0;
    JsonArray menu;
    bool closing = false;
    std::vector<std::wstring> restart;
    std::map<int, std::unique_ptr<View>> views;
    Backend backend;
    com_ptr<ICoreWebView2Environment10> environment;
    com_ptr<IDCompositionDevice> composition;

    View* findView(int id) const {
        const auto item = views.find(id);
        return item == views.end() ? nullptr : item->second.get();
    }

    void registerWindow(const wchar_t* name, WNDPROC procedure, UINT style = 0) const {
        WNDCLASSEXW window{sizeof(WNDCLASSEXW)};
        window.style = style;
        window.hInstance = instance;
        window.lpszClassName = name;
        window.lpfnWndProc = procedure;
        window.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(1));
        window.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        check_bool(RegisterClassExW(&window) != 0);
    }

    void relaunch() const {
        auto command = quote(exe.native());
        for (const auto& argument : restart) command += L" " + quote(argument);
        STARTUPINFOW startup{sizeof(STARTUPINFOW)};
        PROCESS_INFORMATION process{};
        check_bool(CreateProcessW(exe.c_str(), command.data(), nullptr, nullptr, FALSE, 0, nullptr,
            exe.parent_path().c_str(), &startup, &process));
        CloseHandle(process.hProcess);
        CloseHandle(process.hThread);
    }

    void sendDisplays(hstring type) const {
        auto data = event(type);
        data.SetNamedValue(L"displays", workAreas());
        send(data);
    }

    void reply(int id, IJsonValue value = JsonValue::CreateNullValue(), hstring error = L"") const {
        auto data = event(L"reply");
        data.SetNamedValue(L"id", JsonValue::CreateNumberValue(id));
        data.SetNamedValue(L"value", value);
        if (!error.empty()) data.SetNamedValue(L"error", JsonValue::CreateStringValue(error));
        send(data);
    }

    void loadFailed(int window, int id, hstring error) {
        reply(id, JsonValue::CreateNullValue(), error);
        closeView(window);
    }

    void createView(const JsonObject& options, int request) {
        const auto id = static_cast<int>(options.GetNamedNumber(L"window"));
        auto view = std::make_unique<View>(*this, id, options.GetNamedBoolean(L"overlay"));
        view->minimumWidth = static_cast<int>(options.GetNamedNumber(L"minWidth"));
        view->minimumHeight = static_cast<int>(options.GetNamedNumber(L"minHeight"));
        view->uri = hstring(std::wstring(origin) + L"/" + options.GetNamedString(L"page").c_str());

        const auto bounds = options.GetNamedObject(L"bounds");
        const POINT point{static_cast<LONG>(bounds.GetNamedNumber(L"x")), static_cast<LONG>(bounds.GetNamedNumber(L"y"))};
        const auto display = monitor(MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST));
        const auto x = display.physical.left + MulDiv(point.x - display.physical.left, display.dpi, 96);
        const auto y = display.physical.top + MulDiv(point.y - display.physical.top, display.dpi, 96);
        const auto width = MulDiv(static_cast<int>(bounds.GetNamedNumber(L"width")), display.dpi, 96);
        const auto height = MulDiv(static_cast<int>(bounds.GetNamedNumber(L"height")), display.dpi, 96);
        const DWORD flags = view->overlay ?
            WS_EX_NOREDIRECTIONBITMAP | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST : WS_EX_APPWINDOW;
        const auto title = options.GetNamedString(L"title");
        view->window = CreateWindowExW(flags, viewClass, title.c_str(),
            view->overlay ? WS_POPUP : WS_OVERLAPPEDWINDOW, x, y, width, height,
            nullptr, nullptr, instance, view.get());
        check_bool(view->window != nullptr);
        if (view->overlay) view->setLocked(options.GetNamedBoolean(L"locked"));
        views.emplace(id, std::move(view));

        if (environment) {
            createController(id, request);
            return;
        }
        const auto handler = Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [this, id, request](HRESULT status, ICoreWebView2Environment* created) -> HRESULT {
                try {
                    check_hresult(status);
                    check_hresult(created->QueryInterface(IID_PPV_ARGS(environment.put())));
                    createController(id, request);
                } catch (const winrt::hresult_error& error) {
                    loadFailed(id, request, error.message());
                }
                return S_OK;
            });
        check_hresult(CreateCoreWebView2EnvironmentWithOptions(nullptr, profile.c_str(), nullptr, handler.Get()));
    }

    void createController(int id, int request) {
        const auto view = findView(id);
        com_ptr<ICoreWebView2ControllerOptions> options;
        check_hresult(environment->CreateCoreWebView2ControllerOptions(options.put()));
        check_hresult(options->put_IsInPrivateModeEnabled(TRUE));
        if (view->overlay) {
            const auto completed = Callback<ICoreWebView2CreateCoreWebView2CompositionControllerCompletedHandler>(
                [this, id, request](HRESULT status, ICoreWebView2CompositionController* controller) -> HRESULT {
                    try {
                        check_hresult(status);
                        const auto view = findView(id);
                        view->visualController.copy_from(controller);
                        view->controller = view->visualController.as<ICoreWebView2Controller>();
                        connectVisual(*view);
                        navigate(*view, request);
                    } catch (const winrt::hresult_error& error) {
                        loadFailed(id, request, error.message());
                    }
                    return S_OK;
                });
            check_hresult(environment->CreateCoreWebView2CompositionControllerWithOptions(view->window, options.get(), completed.Get()));
        } else {
            const auto completed = Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                [this, id, request](HRESULT status, ICoreWebView2Controller* controller) -> HRESULT {
                    try {
                        check_hresult(status);
                        if (auto view = findView(id)) {
                            view->controller.copy_from(controller);
                            navigate(*view, request);
                        } else {
                            controller->Close();
                        }
                    } catch (const winrt::hresult_error& error) {
                        loadFailed(id, request, error.message());
                    }
                    return S_OK;
                });
            check_hresult(environment->CreateCoreWebView2ControllerWithOptions(view->window, options.get(), completed.Get()));
        }
    }

    void connectVisual(View& view) {
        if (!composition) check_hresult(DCompositionCreateDevice(nullptr, IID_PPV_ARGS(composition.put())));
        check_hresult(composition->CreateTargetForHwnd(view.window, TRUE, view.target.put()));
        check_hresult(composition->CreateVisual(view.visual.put()));
        check_hresult(view.target->SetRoot(view.visual.get()));
        check_hresult(view.visualController->put_RootVisualTarget(view.visual.get()));
        check_hresult(composition->Commit());
    }

    void navigate(View& view, int request) {
        const auto id = view.id;
        check_hresult(view.controller->get_CoreWebView2(view.page.put()));
        const auto controller2 = view.controller.as<ICoreWebView2Controller2>();
        check_hresult(controller2->put_DefaultBackgroundColor(
            view.overlay ? COREWEBVIEW2_COLOR{0, 0, 0, 0} : COREWEBVIEW2_COLOR{255, 248, 245, 242}));
        check_hresult(view.controller.as<ICoreWebView2Controller4>()->put_AllowExternalDrop(FALSE));
        const auto page3 = view.page.as<ICoreWebView2_3>();
        check_hresult(page3->SetVirtualHostNameToFolderMapping(
            L"mineradio.invalid", scripts.c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY));
        com_ptr<ICoreWebView2Settings> settings;
        check_hresult(view.page->get_Settings(settings.put()));
        settings->put_AreDevToolsEnabled(FALSE);
        settings->put_AreDefaultContextMenusEnabled(FALSE);
        settings->put_AreHostObjectsAllowed(FALSE);
        settings->put_IsZoomControlEnabled(FALSE);
        settings.as<ICoreWebView2Settings3>()->put_AreBrowserAcceleratorKeysEnabled(FALSE);

        EventRegistrationToken token;
        const auto navigation = Callback<ICoreWebView2NavigationStartingEventHandler>(
            [uri = view.uri](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                PWSTR raw = nullptr;
                if (FAILED(args->get_Uri(&raw))) return E_FAIL;
                std::unique_ptr<wchar_t, decltype(&CoTaskMemFree)> value(raw, CoTaskMemFree);
                return args->put_Cancel(uri != value.get());
            });
        check_hresult(view.page->add_NavigationStarting(navigation.Get(), &token));
        const auto newWindow = Callback<ICoreWebView2NewWindowRequestedEventHandler>(
            [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                return args->put_Handled(TRUE);
            });
        check_hresult(view.page->add_NewWindowRequested(newWindow.Get(), &token));
        const auto incoming = Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [this, id, uri = view.uri](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                PWSTR source = nullptr;
                PWSTR json = nullptr;
                if (FAILED(args->get_Source(&source))) return E_FAIL;
                std::unique_ptr<wchar_t, decltype(&CoTaskMemFree)> sourceUri(source, CoTaskMemFree);
                if (uri != sourceUri.get()) return S_OK;
                if (FAILED(args->get_WebMessageAsJson(&json))) return E_FAIL;
                std::unique_ptr<wchar_t, decltype(&CoTaskMemFree)> value(json, CoTaskMemFree);
                JsonObject body{nullptr};
                if (JsonObject::TryParse(value.get(), body)) {
                    auto message = event(L"web-message");
                    message.SetNamedValue(L"window", JsonValue::CreateNumberValue(id));
                    message.SetNamedValue(L"data", body);
                    send(message);
                }
                return S_OK;
            });
        check_hresult(view.page->add_WebMessageReceived(incoming.Get(), &token));
        const auto processFailed = Callback<ICoreWebView2ProcessFailedEventHandler>(
            [this, id](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs* args) -> HRESULT {
                COREWEBVIEW2_PROCESS_FAILED_KIND kind;
                args->get_ProcessFailedKind(&kind);
                auto message = event(L"renderer-gone");
                message.SetNamedValue(L"window", JsonValue::CreateNumberValue(id));
                message.SetNamedValue(L"detail", JsonValue::CreateNumberValue(kind));
                send(message);
                return S_OK;
            });
        check_hresult(view.page->add_ProcessFailed(processFailed.Get(), &token));
        const auto completed = Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [this, id, request](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                const auto view = findView(id);
                if (!view || view->loaded) return S_OK;
                BOOL success;
                args->get_IsSuccess(&success);
                if (!success) {
                    COREWEBVIEW2_WEB_ERROR_STATUS status;
                    args->get_WebErrorStatus(&status);
                    reply(request, JsonValue::CreateNullValue(),
                        hstring(L"无法打开桌面歌词页面。WebView2 状态码 " + std::to_wstring(status)));
                    PostMessageW(view->window, WM_CLOSE, 0, 0);
                    return S_OK;
                }
                view->loaded = true;
                if (!view->overlay) view->show(true);
                view->sendBounds();
                reply(request);
                return S_OK;
            });
        check_hresult(view.page->add_NavigationCompleted(completed.Get(), &token));
        view.resize();
        check_hresult(view.page->Navigate(view.uri.c_str()));
    }

    void addTray() {
        tray.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP;
        tray.uCallbackMessage = trayMessage;
        Shell_NotifyIconW(NIM_ADD, &tray);
        tray.uVersion = NOTIFYICON_VERSION_4;
        Shell_NotifyIconW(NIM_SETVERSION, &tray);
    }

    void removeTray() {
        if (tray.hIcon) {
            Shell_NotifyIconW(NIM_DELETE, &tray);
            DestroyIcon(tray.hIcon);
            tray.hIcon = nullptr;
        }
    }

    void showMenu() {
        const auto popup = CreatePopupMenu();
        UINT index = 1;
        for (const auto& item : menu) {
            const auto row = item.GetObject();
            const auto text = row.GetNamedString(L"label");
            AppendMenuW(popup, MF_STRING | (row.GetNamedBoolean(L"enabled") ? MF_ENABLED : MF_GRAYED), index++, text.c_str());
        }
        POINT position;
        GetCursorPos(&position);
        SetForegroundWindow(control);
        const auto selected = TrackPopupMenu(popup, TPM_RIGHTBUTTON | TPM_RETURNCMD | TPM_NONOTIFY,
            position.x, position.y, 0, control, nullptr);
        DestroyMenu(popup);
        PostMessageW(control, WM_NULL, 0, 0);
        if (selected) {
            auto response = event(L"menu");
            response.SetNamedValue(L"index", JsonValue::CreateNumberValue(selected - 1));
            send(response);
        }
    }

    void dispatch(const JsonObject& data) {
        const auto op = data.GetNamedString(L"op");
        const auto id = static_cast<int>(data.GetNamedNumber(L"id", 0));
        try {
            if (op == L"load") {
                createView(data, id);
            } else if (op == L"register-shortcut") {
                const auto key = data.GetNamedString(L"key")[0];
                const bool registered = RegisterHotKey(control, key, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, key);
                reply(id, JsonValue::CreateBooleanValue(registered));
            } else if (op == L"unregister-shortcuts") {
                for (const auto key : {L'H', L'L', L'S', L'Q'}) UnregisterHotKey(control, key);
            } else if (op == L"dialog") {
                JsonObject response;
                response.SetNamedValue(L"response", JsonValue::CreateNumberValue(ask(nullptr, data.GetNamedObject(L"options"))));
                reply(id, response);
            } else if (op == L"open-dialog") {
                reply(id, choosePath(nullptr, data.GetNamedObject(L"options")));
            } else if (op == L"error-box") {
                MessageBoxW(nullptr, data.GetNamedString(L"message").c_str(), data.GetNamedString(L"title").c_str(), MB_OK | MB_ICONERROR);
            } else if (op == L"open") {
                const auto result = ShellExecuteW(nullptr, L"open", data.GetNamedString(L"target").c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                const auto status = reinterpret_cast<INT_PTR>(result);
                reply(id, JsonValue::CreateStringValue(status <= 32 ? hstring(L"Windows 返回错误 " + std::to_wstring(status)) : hstring()));
            } else if (op == L"decode-cover") {
                reply(id, JsonValue::CreateStringValue(decodeCover(data.GetNamedString(L"bytes"))));
            } else if (op == L"system-fonts") {
                reply(id, enumerateFonts(data.GetNamedObject(L"samples")));
            } else if (op == L"tray") {
                tray.hIcon = static_cast<HICON>(LoadImageW(nullptr, data.GetNamedString(L"icon").c_str(), IMAGE_ICON,
                    GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_LOADFROMFILE));
                addTray();
            } else if (op == L"tooltip") {
                wcscpy_s(tray.szTip, data.GetNamedString(L"text").c_str());
                Shell_NotifyIconW(NIM_MODIFY, &tray);
            } else if (op == L"menu") {
                menu = data.GetNamedArray(L"items");
            } else if (op == L"quit") {
                closing = true;
                for (const auto& arg : data.GetNamedArray(L"restart", JsonArray{})) restart.emplace_back(arg.GetString());
                for (auto& [window, view] : views) ShowWindow(view->window, SW_HIDE);
                removeTray();
            } else {
                const auto view = findView(static_cast<int>(data.GetNamedNumber(L"window")));
                if (!view) return; // A queued page response may follow the closing window.
                if (op == L"web-message") {
                    view->page->PostWebMessageAsJson(data.GetNamedObject(L"data").Stringify().c_str());
                } else if (op == L"show") {
                    view->show(true);
                } else if (op == L"hide") {
                    view->dragging = false;
                    view->show(false);
                } else if (op == L"close") {
                    closeView(view->id);
                } else if (op == L"focus") {
                    SetForegroundWindow(view->window);
                } else if (op == L"locked") {
                    view->setLocked(data.GetNamedBoolean(L"locked"));
                } else if (op == L"hot-bounds") {
                    const auto bounds = data.GetNamedObject(L"bounds");
                    view->hotBounds = {
                        static_cast<LONG>(bounds.GetNamedNumber(L"left")),
                        static_cast<LONG>(bounds.GetNamedNumber(L"top")),
                        static_cast<LONG>(bounds.GetNamedNumber(L"right")),
                        static_cast<LONG>(bounds.GetNamedNumber(L"bottom")),
                    };
                } else if (op == L"dragging") {
                    if (data.GetNamedBoolean(L"active")) view->beginDrag();
                    else if (!(GetAsyncKeyState(VK_LBUTTON) & 0x8000)) view->dragging = false;
                }
            }
        } catch (const winrt::hresult_error& error) {
            if (op == L"load") loadFailed(static_cast<int>(data.GetNamedNumber(L"window")), id, error.message());
            else if (id) reply(id, JsonValue::CreateNullValue(), error.message());
            else throw;
        }
    }

    LRESULT message(UINT message, WPARAM wParam, LPARAM lParam) {
        if (message == taskbarCreated && tray.hIcon) addTray();
        switch (message) {
        case pipeLine: {
            std::unique_ptr<std::string> line(reinterpret_cast<std::string*>(lParam));
            if (!closing) dispatch(JsonObject::Parse(winrt::to_hstring(*line)));
            return 0;
        }
        case pipeClosed: {
            const auto code = backend.exitCode();
            if (!closing && code)
                MessageBoxW(nullptr, (L"歌词进程已退出。日志目录：\n" + logs.native()).c_str(), product, MB_OK | MB_ICONERROR);
            PostQuitMessage(code);
            return 0;
        }
        case WM_HOTKEY: {
            auto pressed = event(L"shortcut");
            const wchar_t key[]{static_cast<wchar_t>(wParam), L'\0'};
            pressed.SetNamedValue(L"key", JsonValue::CreateStringValue(key));
            send(pressed);
            return 0;
        }
        case WM_DISPLAYCHANGE:
            sendDisplays(L"displays");
            return 0;
        case trayMessage:
            if (LOWORD(lParam) == WM_CONTEXTMENU || LOWORD(lParam) == NIN_SELECT || LOWORD(lParam) == NIN_KEYSELECT) showMenu();
            return 0;
        case WM_CLOSE:
            send(event(L"quit"));
            return 0;
        }
        return DefWindowProcW(control, message, wParam, lParam);
    }

    static LRESULT CALLBACK procedure(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
        if (message == WM_NCCREATE) {
            const auto create = reinterpret_cast<CREATESTRUCTW*>(lParam);
            auto host = static_cast<Host*>(create->lpCreateParams);
            host->control = window;
            SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(host));
        }
        const auto host = reinterpret_cast<Host*>(GetWindowLongPtrW(window, GWLP_USERDATA));
        if (!host) return DefWindowProcW(window, message, wParam, lParam);
        try {
            return host->message(message, wParam, lParam);
        } catch (const winrt::hresult_error& error) {
            MessageBoxW(nullptr, error.message().c_str(), product, MB_OK | MB_ICONERROR);
            PostQuitMessage(1);
            return 0;
        }
    }
};

void View::sendBounds() const {
    if (!loaded) return;
    RECT rect;
    GetWindowRect(window, &rect);
    auto data = event(L"bounds");
    data.SetNamedValue(L"window", JsonValue::CreateNumberValue(id));
    data.SetNamedValue(L"bounds", logicalBounds(rect, monitor(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST))));
    host.send(data);
}

void View::beginDrag() {
    if (locked || dragging || !(GetAsyncKeyState(VK_LBUTTON) & 0x8000)) return;
    GetCursorPos(&cursor);
    GetWindowRect(window, &dragStart);
    dragHotBounds = hotBounds;
    dragging = true;
}

void View::pollMouse() {
    const bool middle = (GetAsyncKeyState(VK_MBUTTON) & 0x8000) != 0;
    const bool middlePressed = middle && !middleDown;
    middleDown = middle;
    if (!locked && !middlePressed && !dragging) return;
    POINT point;
    if (!GetCursorPos(&point)) {
        setLockedHover(false);
        return;
    }
    if (locked || middlePressed) {
        const auto dpi = GetDpiForWindow(window);
        POINT client = point;
        ScreenToClient(window, &client);
        client = {MulDiv(client.x, 96, dpi), MulDiv(client.y, 96, dpi)};
        const bool inside = PtInRect(&hotBounds, client);
        // The click-through window does not receive WM_MOUSELEAVE.
        if (locked) setLockedHover(inside);
        if (middlePressed && inside) {
            auto data = event(L"middle-button");
            data.SetNamedValue(L"window", JsonValue::CreateNumberValue(id));
            host.send(data);
        }
    }
    if (!dragging) return;
    if (!(GetAsyncKeyState(VK_LBUTTON) & 0x8000)) {
        dragging = false;
        if (GetCapture() == window) ReleaseCapture();
        return;
    }

    const auto display = monitor(MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST));
    const auto edge = MulDiv(12, display.dpi, 96);
    const auto& bounds = display.work;
    const auto left = bounds.left + edge - MulDiv(dragHotBounds.left, display.dpi, 96);
    const auto right = bounds.right - edge - MulDiv(dragHotBounds.right, display.dpi, 96);
    const auto top = bounds.top + edge - MulDiv(dragHotBounds.top, display.dpi, 96);
    const auto bottom = bounds.bottom - edge - MulDiv(dragHotBounds.bottom, display.dpi, 96);
    const auto x = std::clamp(dragStart.left + point.x - cursor.x, left, std::max(left, right));
    const auto y = std::clamp(dragStart.top + point.y - cursor.y, top, std::max(top, bottom));
    RECT current;
    GetWindowRect(window, &current);
    if (current.left != x || current.top != y)
        SetWindowPos(window, nullptr, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
}

LRESULT View::message(UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case WM_CLOSE: host.closeView(id); return 0;
    case WM_TIMER:
        if (wParam == mouseTimer && IsWindowVisible(window)) pollMouse();
        return 0;
    case WM_MOUSEACTIVATE: if (overlay) return MA_NOACTIVATE; break;
    case WM_GETMINMAXINFO:
        if (!overlay) {
            const UINT dpi = GetDpiForWindow(window);
            auto& info = *reinterpret_cast<MINMAXINFO*>(lParam);
            info.ptMinTrackSize = {MulDiv(minimumWidth, dpi, 96), MulDiv(minimumHeight, dpi, 96)};
        }
        return 0;
    case WM_SIZE:
        resize();
        if (!overlay && loaded) {
            const bool minimized = wParam == SIZE_MINIMIZED;
            controller->put_IsVisible(!minimized);
            if (minimized) {
                const auto done = Callback<ICoreWebView2TrySuspendCompletedHandler>(
                    [](HRESULT, BOOL) -> HRESULT { return S_OK; });
                page.as<ICoreWebView2_3>()->TrySuspend(done.Get());
            }
        }
        sendBounds();
        return 0;
    case WM_MOVE:
        if (controller) controller->NotifyParentWindowPositionChanged();
        sendBounds();
        return 0;
    case WM_DPICHANGED: {
        const auto& bounds = *reinterpret_cast<RECT*>(lParam);
        SetWindowPos(window, nullptr, bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top,
            SWP_NOZORDER | SWP_NOACTIVATE);
        return 0;
    }
    case WM_MOUSELEAVE:
        mouseTracked = false;
        if (visualController) visualController->SendMouseInput(COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE,
            COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE, 0, {0, 0});
        return 0;
    case WM_MOUSEMOVE:
    case WM_LBUTTONDOWN: case WM_LBUTTONUP: case WM_LBUTTONDBLCLK:
    case WM_RBUTTONDOWN: case WM_RBUTTONUP: case WM_RBUTTONDBLCLK:
    case WM_MOUSEWHEEL: case WM_MOUSEHWHEEL:
        if (visualController && !locked) {
            POINT point{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
            auto mouseData = 0u;
            if (message == WM_MOUSEMOVE && !mouseTracked) {
                TRACKMOUSEEVENT tracking{sizeof(TRACKMOUSEEVENT), TME_LEAVE, window, 0};
                mouseTracked = TrackMouseEvent(&tracking);
            } else if (message == WM_MOUSEWHEEL || message == WM_MOUSEHWHEEL) {
                ScreenToClient(window, &point);
                mouseData = GET_WHEEL_DELTA_WPARAM(wParam);
            } else if (message == WM_LBUTTONDOWN || message == WM_RBUTTONDOWN) {
                SetCapture(window);
            } else if ((message == WM_LBUTTONUP || message == WM_RBUTTONUP) && GetCapture() == window) {
                ReleaseCapture();
            }
            visualController->SendMouseInput(static_cast<COREWEBVIEW2_MOUSE_EVENT_KIND>(message),
                static_cast<COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS>(GET_KEYSTATE_WPARAM(wParam)), mouseData, point);
            return 0;
        }
        break;
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

LRESULT CALLBACK View::procedure(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_NCCREATE) {
        const auto create = reinterpret_cast<CREATESTRUCTW*>(lParam);
        const auto view = static_cast<View*>(create->lpCreateParams);
        view->window = window;
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(view));
    }
    const auto view = reinterpret_cast<View*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    return view ? view->message(message, wParam, lParam) : DefWindowProcW(window, message, wParam, lParam);
}

} // namespace desktop

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    winrt::init_apartment(winrt::apartment_type::single_threaded);
    try {
        int count;
        auto raw = CommandLineToArgvW(GetCommandLineW(), &count);
        winrt::check_bool(raw != nullptr);
        std::unique_ptr<LPWSTR, decltype(&LocalFree)> arguments(raw, LocalFree);
        return desktop::Host(instance).run({raw + 1, raw + count});
    } catch (const winrt::hresult_error& error) {
        MessageBoxW(nullptr, error.message().c_str(), desktop::product, MB_OK | MB_ICONERROR);
    } catch (const std::exception& error) {
        MessageBoxW(nullptr, winrt::to_hstring(error.what()).c_str(), desktop::product, MB_OK | MB_ICONERROR);
    }
    return 1;
}
