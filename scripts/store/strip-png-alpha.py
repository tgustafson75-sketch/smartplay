#!/usr/bin/env python3
"""
Strip the alpha channel from a PNG, losslessly, with no third-party dependencies.

2026-09-04 — App Store Connect REJECTS any screenshot carrying an alpha channel, and
`xcrun simctl io <device> screenshot` always emits colortype 6 (RGBA). The alpha it writes is fully
opaque, so the file looks perfect in Preview and in every viewer — the image is right, the container
is wrong, and looking at it can never tell you. Cowork caught it at upload after ASC refused the
Apple Watch screenshot I produced.

Why not `sips`: measured, `sips -s format png` on a PNG PRESERVES the alpha channel — input
colortype 6, output colortype 6. The only sips route that drops it is a JPEG round-trip, which is
lossy, and these are marketing assets where text edges matter.

So: decode, drop the alpha bytes, re-encode. Handles the five PNG filter types per RFC 2083.
Composites over white only where a pixel is actually transparent — a screenshot's alpha is normally
opaque, and silently darkening real transparency would be a different kind of wrong.

Usage:  strip-png-alpha.py <in.png> [out.png]     (in place if out is omitted)
"""
import struct, sys, zlib


def _chunks(data: bytes):
    pos = 8
    while pos < len(data):
        (length,) = struct.unpack('>I', data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        yield ctype, body
        pos += 12 + length


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)


def strip_alpha(src: bytes) -> bytes:
    if src[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG')
    width = height = depth = color = None
    idat = b''
    for ctype, body in _chunks(src):
        if ctype == b'IHDR':
            width, height, depth, color, comp, filt, inter = struct.unpack('>IIBBBBB', body)
            if depth != 8 or comp != 0 or filt != 0 or inter != 0:
                raise ValueError(f'unsupported PNG (depth={depth} interlace={inter})')
        elif ctype == b'IDAT':
            idat += body
        elif ctype == b'IEND':
            break

    if color == 2:
        return src  # already RGB — nothing to do, and re-encoding would only risk making it worse
    if color != 6:
        raise ValueError(f'unsupported colour type {color}; expected 6 (RGBA) or 2 (RGB)')

    raw = zlib.decompress(idat)
    bpp = 4                      # RGBA, 8-bit
    stride = width * bpp
    out_stride = width * 3
    prev = bytearray(stride)
    rows = []
    pos = 0
    for _ in range(height):
        ftype = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos + stride]); pos += stride
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if ftype == 0:   pass
            elif ftype == 1: line[i] = (line[i] + a) & 0xFF
            elif ftype == 2: line[i] = (line[i] + b) & 0xFF
            elif ftype == 3: line[i] = (line[i] + ((a + b) >> 1)) & 0xFF
            elif ftype == 4: line[i] = (line[i] + _paeth(a, b, c)) & 0xFF
            else: raise ValueError(f'bad filter type {ftype}')
        prev = line
        rgb = bytearray(out_stride)
        for x in range(width):
            r, g, bl, al = line[x * 4:x * 4 + 4]
            if al == 255:
                rgb[x * 3:x * 3 + 3] = bytes((r, g, bl))
            else:
                # Composite over white, the background ASC renders against.
                f = al / 255.0
                rgb[x * 3:x * 3 + 3] = bytes((
                    round(r * f + 255 * (1 - f)),
                    round(g * f + 255 * (1 - f)),
                    round(bl * f + 255 * (1 - f)),
                ))
        rows.append(b'\x00' + bytes(rgb))   # filter type 0; these compress fine and stay simple

    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack('>I', len(body)) + tag + body + struct.pack('>I', zlib.crc32(tag + body) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b''))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__.strip().splitlines()[-1])
    src_path = sys.argv[1]
    dst_path = sys.argv[2] if len(sys.argv) > 2 else src_path
    out = strip_alpha(open(src_path, 'rb').read())
    open(dst_path, 'wb').write(out)
    w, h = struct.unpack('>II', out[16:24])
    print(f'{dst_path}: {w}x{h} colortype={out[25]} {len(out)} bytes '
          f'{"OK — no alpha, safe to upload" if out[25] != 6 else "FAILED"}')
