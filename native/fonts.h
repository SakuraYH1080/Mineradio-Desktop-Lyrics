#pragma once
#include "platform.h"
#include <dwrite.h>
#include <initializer_list>

namespace desktop {
inline std::wstring fontName(const com_ptr<IDWriteLocalizedStrings>& names, UINT32 index) {
    UINT32 length;
    check_hresult(names->GetStringLength(index, &length));
    std::wstring text(length + 1, L'\0');
    check_hresult(names->GetString(index, text.data(), length + 1));
    text.resize(length);
    return text;
}

inline UINT32 preferredFontName(const com_ptr<IDWriteLocalizedStrings>& names,
                               std::initializer_list<const wchar_t*> locales) {
    for (const auto locale : locales) {
        UINT32 index;
        BOOL found;
        check_hresult(names->FindLocaleName(locale, &index, &found));
        if (found) return index;
    }
    return 0;
}

inline JsonArray enumerateFonts(const JsonObject& samples) {
    com_ptr<IDWriteFactory> factory;
    check_hresult(DWriteCreateFactory(DWRITE_FACTORY_TYPE_ISOLATED, __uuidof(IDWriteFactory),
        reinterpret_cast<IUnknown**>(factory.put())));
    com_ptr<IDWriteFontCollection> collection;
    check_hresult(factory->GetSystemFontCollection(collection.put(), FALSE));
    wchar_t userLocale[LOCALE_NAME_MAX_LENGTH]{};
    GetUserDefaultLocaleName(userLocale, LOCALE_NAME_MAX_LENGTH);

    struct Sample {
        hstring script;
        size_t first;
        size_t last;
    };
    std::vector<Sample> groups;
    std::vector<UINT32> characters;
    for (const auto& entry : samples) {
        const auto text = entry.Value().GetString();
        const auto first = characters.size();
        for (const wchar_t ch : text) characters.push_back(ch);
        groups.push_back({entry.Key(), first, characters.size()});
    }

    JsonArray rows;
    for (UINT32 index = 0; index < collection->GetFontFamilyCount(); ++index) {
        com_ptr<IDWriteFontFamily> family;
        check_hresult(collection->GetFontFamily(index, family.put()));
        com_ptr<IDWriteLocalizedStrings> names;
        check_hresult(family->GetFamilyNames(names.put()));
        const auto name = fontName(names, preferredFontName(names, {L"en-us"}));
        if (name.empty() || name.front() == L'@') continue;
        const auto localized = fontName(names, preferredFontName(names, {L"zh-cn", L"zh-hans", userLocale, L"en-us"}));
        const auto label = localized == name ? name : localized + L" (" + name + L")";

        std::vector<bool> covered(characters.size());
        auto remaining = characters.size();
        const UINT32 fontCount = family->GetFontCount();
        for (UINT32 face = 0; face < fontCount && remaining; ++face) {
            com_ptr<IDWriteFont> font;
            check_hresult(family->GetFont(face, font.put()));
            for (size_t ch = 0; ch < characters.size(); ++ch) {
                if (covered[ch]) continue;
                BOOL supported;
                if (SUCCEEDED(font->HasCharacter(characters[ch], &supported)) && supported) {
                    covered[ch] = true;
                    --remaining;
                }
            }
        }
        JsonObject coverage;
        for (const auto& group : groups) {
            size_t count = 0;
            for (auto ch = group.first; ch < group.last; ++ch) count += covered[ch];
            JsonObject result;
            result.SetNamedValue(L"covered", JsonValue::CreateNumberValue(static_cast<double>(count)));
            result.SetNamedValue(L"total", JsonValue::CreateNumberValue(static_cast<double>(group.last - group.first)));
            coverage.SetNamedValue(group.script, result);
        }
        JsonObject row;
        row.SetNamedValue(L"family", JsonValue::CreateStringValue(hstring(name)));
        row.SetNamedValue(L"label", JsonValue::CreateStringValue(hstring(label)));
        row.SetNamedValue(L"coverage", coverage);
        rows.Append(row);
    }
    return rows;
}
} // namespace desktop
