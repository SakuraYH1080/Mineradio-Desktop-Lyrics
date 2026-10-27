"""Rasterize the editable, rectangle-based project SVG icons using Pillow.

No system fonts, downloaded artwork or running application are involved.
SVG files remain the editable source of truth; unsupported SVG drawing features
fail explicitly rather than silently producing a different raster image.
"""
from pathlib import Path
from io import BytesIO
import json
import struct
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / 'public/icons'
APP_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
TRAY_SIZES = (16, 20, 24, 32, 40, 48, 64)


def rasterize(file, size):
    source = ET.parse(file).getroot()
    viewbox = tuple(float(v) for v in source.attrib['viewBox'].split())
    if viewbox != (0.0, 0.0, 256.0, 256.0):
        raise ValueError('Expected the project 256-unit square SVG viewBox')
    scale = size * 8 / 256
    image = Image.new('RGBA', (size * 8, size * 8), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for node in source.iter():
        kind = node.tag.rsplit('}', 1)[-1]
        if kind in ('svg', 'g', 'title', 'desc'):
            if 'transform' in node.attrib:
                raise ValueError('Bake transforms into editable coordinates before generating')
            continue
        if kind != 'rect':
            raise ValueError('Unsupported drawing element: ' + kind)
        if set(node.attrib) - {'id', 'x', 'y', 'width', 'height', 'rx', 'fill'}:
            raise ValueError('Unsupported rect attribute')
        value = lambda key, fallback='0': float(node.attrib.get(key, fallback))
        x, y, width, height = (value(key) for key in ('x', 'y', 'width', 'height'))
        draw.rounded_rectangle((x*scale, y*scale, (x+width)*scale, (y+height)*scale),
                               radius=value('rx')*scale, fill=node.attrib['fill'])
    return image.resize((size, size), Image.Resampling.LANCZOS)


def dib(image):
    """32-bit bottom-up DIB plus a real 1-bit AND mask for small ICO entries."""
    width, height = image.size
    raw = image.tobytes('raw', 'BGRA')
    stride = width * 4
    pixels = b''.join(raw[row*stride:(row+1)*stride] for row in reversed(range(height)))
    mask_stride = ((width + 31) // 32) * 4
    alpha = image.getchannel('A')
    mask = bytearray(mask_stride * height)
    for y in range(height):
        for x in range(width):
            if alpha.getpixel((x, y)) == 0:
                mask[(height-1-y)*mask_stride + x//8] |= 0x80 >> (x % 8)
    header = struct.pack('<IIIHHIIIIII', 40, width, height*2, 1, 32, 0,
                         len(pixels)+len(mask), 0, 0, 0, 0)
    return header + pixels + bytes(mask)


def write_ico(file, images):
    payloads = []
    for image in images:
        if image.width == 256:
            data = BytesIO()
            image.save(data, format='PNG')
            payloads.append(data.getvalue())
        else:
            payloads.append(dib(image))
    offset = 6 + 16 * len(images)
    entries = []
    for image, data in zip(images, payloads):
        entries.append(struct.pack('<BBBBHHII', image.width % 256, image.height % 256,
                                   0, 0, 1, 32, len(data), offset))
        offset += len(data)
    file.write_bytes(struct.pack('<HHH', 0, 1, len(images)) + b''.join(entries) + b''.join(payloads))


def main():
    for name, sizes, main_size in [('app', APP_SIZES, 1024), ('tray', TRAY_SIZES, 64)]:
        source = ICONS / (name + '.svg')
        images = [rasterize(source, size) for size in sizes]
        for image in images:
            image.save(ICONS / f'{name}-{image.width}.png')
        rasterize(source, main_size).save(ICONS / (name + '.png'))
        write_ico(ICONS / (name + '.ico'), images)
    # Static artwork sheet only: tiny icons are pasted at their true pixel size.
    # It is not an application/system screenshot or an alternative proposal.
    preview = Image.new('RGB', (880, 390), '#E9E7F1')
    draw = ImageDraw.Draw(preview)
    preview.paste(rasterize(ICONS / 'app.svg', 256), (23, 65), rasterize(ICONS / 'app.svg', 256))
    draw.text((28, 24), 'Mineradio Desktop Lyrics', fill='#252238')
    draw.text((36, 340), 'Original SVG / 1024px PNG', fill='#575169')
    for top, background, foreground, name in [(20, '#F8F7FC', '#252238', 'Light surface'),
                                               (205, '#20212A', '#F7F6FC', 'Dark surface')]:
        draw.rounded_rectangle((305, top, 859, top+165), radius=18, fill=background)
        draw.text((325, top+12), name+' - icons below are actual pixels', fill=foreground)
        for index, size in enumerate((16, 20, 24, 32)):
            x = 402 + index*105
            draw.text((x, top+35), str(size)+'px', fill=foreground)
            for y, kind in [(top+60, 'app'), (top+112, 'tray')]:
                image = rasterize(ICONS / (kind+'.svg'), size)
                preview.paste(image, (x, y), image)
        draw.text((325, top+63), 'App', fill=foreground)
        draw.text((325, top+115), 'Tray', fill=foreground)
    preview.save(ICONS / 'icon-preview.png')
    print(json.dumps({'source':'public/icons/*.svg', 'appPng':1024,
                      'appIcoSizes':APP_SIZES, 'trayPng':64,
                      'trayIcoSizes':TRAY_SIZES}))


if __name__ == '__main__':
    main()
