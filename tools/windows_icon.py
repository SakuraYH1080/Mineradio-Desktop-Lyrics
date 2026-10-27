"""Embed a real multi-image ICO in a copied Windows executable.

Uses only the standard library and Win32 resource APIs. No application code is
executed. Callers must pass their build output, never the pinned runtime input.
"""
import ctypes
from ctypes import wintypes
import hashlib
import os
from pathlib import Path
import struct

RT_ICON = 3
RT_GROUP_ICON = 14
NEUTRAL_LANGUAGE = 0


def _api():
    if os.name != 'nt':
        raise OSError('Windows resource editing requires Windows.')
    api = ctypes.WinDLL('kernel32', use_last_error=True)
    api.LoadLibraryExW.argtypes = [wintypes.LPCWSTR, wintypes.HANDLE, wintypes.DWORD]
    api.LoadLibraryExW.restype = wintypes.HMODULE
    api.FreeLibrary.argtypes = [wintypes.HMODULE]
    api.FreeLibrary.restype = wintypes.BOOL
    api.EnumResourceNamesW.argtypes = [wintypes.HMODULE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ssize_t]
    api.EnumResourceNamesW.restype = wintypes.BOOL
    api.EnumResourceLanguagesW.argtypes = [wintypes.HMODULE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ssize_t]
    api.EnumResourceLanguagesW.restype = wintypes.BOOL
    api.FindResourceExW.argtypes = [wintypes.HMODULE, ctypes.c_void_p, ctypes.c_void_p, wintypes.WORD]
    api.FindResourceExW.restype = wintypes.HRSRC
    api.SizeofResource.argtypes = [wintypes.HMODULE, wintypes.HRSRC]
    api.SizeofResource.restype = wintypes.DWORD
    api.LoadResource.argtypes = [wintypes.HMODULE, wintypes.HRSRC]
    api.LoadResource.restype = wintypes.HGLOBAL
    api.LockResource.argtypes = [wintypes.HGLOBAL]
    api.LockResource.restype = ctypes.c_void_p
    api.BeginUpdateResourceW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]
    api.BeginUpdateResourceW.restype = wintypes.HANDLE
    api.UpdateResourceW.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, wintypes.WORD, ctypes.c_void_p, wintypes.DWORD]
    api.UpdateResourceW.restype = wintypes.BOOL
    api.EndUpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.BOOL]
    api.EndUpdateResourceW.restype = wintypes.BOOL
    return api


def _identifier(value):
    if isinstance(value, int):
        if not 0 <= value <= 0xffff:
            raise ValueError('Resource integer identifier is outside WORD range.')
        return ctypes.c_void_p(value)
    return ctypes.cast(ctypes.c_wchar_p(value), ctypes.c_void_p)


def _name(pointer):
    value = pointer or 0
    return value if value <= 0xffff else ctypes.wstring_at(value)


def _load(api, executable):
    # AS_DATAFILE | AS_IMAGE_RESOURCE: map resources without running DLL entry code.
    module = api.LoadLibraryExW(str(Path(executable).resolve()), None, 0x2 | 0x20)
    if not module:
        raise ctypes.WinError(ctypes.get_last_error())
    return module


def _entries(api, module, resource_type):
    names, entries, failures = [], [], []
    name_callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMODULE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ssize_t)
    language_callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMODULE, ctypes.c_void_p, ctypes.c_void_p, wintypes.WORD, ctypes.c_ssize_t)

    @name_callback
    def collect_name(_module, _type, name, _data):
        try:
            names.append(_name(name))
            return True
        except Exception as error:
            failures.append(error)
            return False

    ctypes.set_last_error(0)
    success = api.EnumResourceNamesW(module, _identifier(resource_type), ctypes.cast(collect_name, ctypes.c_void_p), 0)
    if failures:
        raise failures[0]
    if not success and ctypes.get_last_error() not in (0, 1813):
        raise ctypes.WinError(ctypes.get_last_error())
    for name in names:
        @language_callback
        def collect_language(_module, _type, _name, language, _data):
            entries.append((resource_type, name, language))
            return True
        if not api.EnumResourceLanguagesW(module, _identifier(resource_type), _identifier(name), ctypes.cast(collect_language, ctypes.c_void_p), 0):
            raise ctypes.WinError(ctypes.get_last_error())
    return entries


def _resource(api, module, resource_type, name, language):
    reference = api.FindResourceExW(module, _identifier(resource_type), _identifier(name), language)
    if not reference:
        raise ctypes.WinError(ctypes.get_last_error())
    size = api.SizeofResource(module, reference)
    loaded = api.LoadResource(module, reference)
    address = api.LockResource(loaded) if loaded else None
    if not size or not address:
        raise OSError('Could not read image resource bytes.')
    return ctypes.string_at(address, size)


def read_ico(ico):
    data = Path(ico).read_bytes()
    if len(data) < 6:
        raise ValueError('Truncated ICO header.')
    reserved, kind, count = struct.unpack_from('<HHH', data)
    if reserved or kind != 1 or not count or len(data) < 6 + count * 16:
        raise ValueError('Expected an actual multi-image Windows ICO directory.')
    images = []
    for index in range(count):
        width, height, colors, unused, planes, bits, length, offset = struct.unpack_from('<BBBBHHII', data, 6 + index * 16)
        if unused or not length or offset < 6 + count * 16 or offset + length > len(data):
            raise ValueError('Invalid ICO image directory entry.')
        payload = data[offset:offset + length]
        actual_width, actual_height = width or 256, height or 256
        if payload.startswith(b'\x89PNG\r\n\x1a\n'):
            if len(payload) < 24 or payload[12:16] != b'IHDR' or struct.unpack_from('>II', payload, 16) != (actual_width, actual_height):
                raise ValueError('PNG dimensions do not match the ICO entry.')
        else:
            if len(payload) < 40 or struct.unpack_from('<I', payload)[0] < 40:
                raise ValueError('Unsupported or truncated ICO bitmap.')
            dib_width, dib_height = struct.unpack_from('<ii', payload, 4)
            if (dib_width, abs(dib_height)) != (actual_width, actual_height * 2):
                raise ValueError('DIB dimensions do not match the ICO entry.')
        images.append({'width':actual_width, 'height':actual_height, 'widthByte':width, 'heightByte':height,
                       'colors':colors, 'planes':planes or 1, 'bits':bits or 32, 'payload':payload})
    return images


def read_resource_icons(executable):
    """Read group/image sizes and payload hashes without launching the executable."""
    api = _api()
    module = _load(api, executable)
    try:
        groups = []
        icon_entries = _entries(api, module, RT_ICON)
        for kind, name, language in _entries(api, module, RT_GROUP_ICON):
            data = _resource(api, module, kind, name, language)
            if len(data) < 6:
                raise ValueError('Truncated icon-group resource.')
            reserved, group_type, count = struct.unpack_from('<HHH', data)
            if reserved or group_type != 1 or len(data) != 6 + count * 14:
                raise ValueError('Malformed icon-group resource.')
            images = []
            for index in range(count):
                width, height, colors, unused, planes, bits, size, resource_id = struct.unpack_from('<BBBBHHIH', data, 6 + index * 14)
                payload = _resource(api, module, RT_ICON, resource_id, language)
                if len(payload) != size:
                    raise ValueError('Icon-group byte size differs from its image resource.')
                images.append({'width':width or 256, 'height':height or 256, 'planes':planes,
                               'bits':bits, 'resourceId':resource_id, 'bytes':size,
                               'sha256':hashlib.sha256(payload).hexdigest()})
            groups.append({'name':name, 'language':language, 'count':count, 'images':images})
        return {'groups':groups, 'iconResources':len(icon_entries)}
    finally:
        api.FreeLibrary(module)


def embed_icon(executable, ico):
    """Replace only RT_ICON/RT_GROUP_ICON in a copied build EXE, transactionally."""
    executable = Path(executable).resolve()
    # A hard guard prevents the usual accidental call against the pinned input.
    if any(part.lower() == 'node_modules' for part in executable.parts):
        raise ValueError('Refusing to edit a node_modules runtime. Copy it into the build first.')
    images = read_ico(ico)
    api = _api()
    module = _load(api, executable)
    try:
        old = _entries(api, module, RT_GROUP_ICON) + _entries(api, module, RT_ICON)
    finally:
        api.FreeLibrary(module)
    handle = api.BeginUpdateResourceW(str(executable), False)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    pending = True
    try:
        for kind, name, language in old:
            if not api.UpdateResourceW(handle, _identifier(kind), _identifier(name), language, None, 0):
                raise ctypes.WinError(ctypes.get_last_error())
        group = bytearray(struct.pack('<HHH', 0, 1, len(images)))
        for resource_id, image in enumerate(images, 1):
            payload = image['payload']
            memory = ctypes.create_string_buffer(payload)
            if not api.UpdateResourceW(handle, _identifier(RT_ICON), _identifier(resource_id), NEUTRAL_LANGUAGE, memory, len(payload)):
                raise ctypes.WinError(ctypes.get_last_error())
            group.extend(struct.pack('<BBBBHHIH', image['widthByte'], image['heightByte'], image['colors'], 0,
                                     image['planes'], image['bits'], len(payload), resource_id))
        memory = ctypes.create_string_buffer(bytes(group))
        if not api.UpdateResourceW(handle, _identifier(RT_GROUP_ICON), _identifier(1), NEUTRAL_LANGUAGE, memory, len(group)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not api.EndUpdateResourceW(handle, False):
            raise ctypes.WinError(ctypes.get_last_error())
        pending = False
    finally:
        if pending:
            api.EndUpdateResourceW(handle, True)
    result = read_resource_icons(executable)
    expected = [hashlib.sha256(image['payload']).hexdigest() for image in images]
    if len(result['groups']) != 1 or [image['sha256'] for image in result['groups'][0]['images']] != expected:
        raise ValueError('Embedded icon resources do not match the supplied ICO.')
    return result
