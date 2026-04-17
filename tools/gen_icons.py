"""
Gerador de icones da extensao seirtao.

Usa apenas a biblioteca padrao do Python (struct, zlib). Nao depende de PIL,
Pillow, cairo ou qualquer coisa externa — util no ambiente Windows da JFCE
onde nem sempre se pode instalar pacotes Python.

Saida: icons/icon16.png, icon32.png, icon48.png, icon128.png

Identidade visual do seirtao (azul institucional SEI/gov.br):
    - Fundo: quadrado arredondado em gradiente azul SEI
      (#1351B4 azul-primario -> #0C326F azul-profundo), mesma paleta
      usada pelo paidegua e pelo gov.br — assim o icone "pertence" ao
      ecossistema do SEI e nao destoa na navbar do sistema.
    - Glifo central: sol amarelo gov.br (#FFCD07), disco grande,
      ligeiramente deslocado para cima, ocupando cerca de 55% da area.
      O amarelo sobre o azul reforca a associacao visual com a marca
      institucional do governo brasileiro.
    - Primeiro plano: silhueta de mandacaru (cactus simbolico cearense)
      em branco (#FFFFFF). Construido como 5 retangulos: tronco central
      + 2 bracos em L simetricos. Recortado sobre o sol — leitura
      imediata da cena "sertao + sol" e do trocadilho SEI+sertao.

Rode a partir da raiz do projeto:
    python tools\\gen_icons.py
"""

from __future__ import annotations

import os
import struct
import zlib

# Paleta azul institucional SEI / gov.br
BLUE_TOP = (19, 81, 180, 255)     # #1351B4 — azul primario SEI
BLUE_BOT = (12, 50, 111, 255)     # #0C326F — azul profundo
SUN = (255, 205, 7, 255)          # #FFCD07 — amarelo gov.br
CACTUS = (255, 255, 255, 255)     # #FFFFFF — branco (silhueta contra o sol)
TRANSPARENT = (0, 0, 0, 0)


def rounded_rect_contains(
    x: int, y: int, x0: int, y0: int, x1: int, y1: int, r: int
) -> bool:
    """Retorna True se (x, y) esta dentro de um retangulo arredondado."""
    if x < x0 or x >= x1 or y < y0 or y >= y1:
        return False
    cx: int | None = None
    cy: int | None = None
    if x < x0 + r and y < y0 + r:
        cx, cy = x0 + r, y0 + r
    elif x >= x1 - r and y < y0 + r:
        cx, cy = x1 - r - 1, y0 + r
    elif x < x0 + r and y >= y1 - r:
        cx, cy = x0 + r, y1 - r - 1
    elif x >= x1 - r and y >= y1 - r:
        cx, cy = x1 - r - 1, y1 - r - 1
    if cx is None or cy is None:
        return True
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= r * r


def lerp_color(
    c1: tuple[int, int, int, int],
    c2: tuple[int, int, int, int],
    t: float,
) -> tuple[int, int, int, int]:
    """Interpolacao linear entre duas cores RGBA (t em [0,1])."""
    if t < 0.0:
        t = 0.0
    elif t > 1.0:
        t = 1.0
    return (
        int(c1[0] + (c2[0] - c1[0]) * t),
        int(c1[1] + (c2[1] - c1[1]) * t),
        int(c1[2] + (c2[2] - c1[2]) * t),
        255,
    )


def in_rect(x: int, y: int, x0: float, y0: float, x1: float, y1: float) -> bool:
    return x0 <= x < x1 and y0 <= y < y1


def render(size: int) -> list[bytes]:
    s = size
    bg_r = max(2, int(s * 0.22))

    # --- Sol: disco centrado-alto, ocupa a maior parte da frame ---
    sun_cx = s * 0.50
    sun_cy = s * 0.46
    sun_r = s * 0.38
    sun_r2 = sun_r * sun_r

    # --- Mandacaru: tronco + 2 bracos em L simetricos ---
    # Em tamanhos pequenos, afinamos o cacto para o sol dominar visualmente.
    scale_small = 1.0 if s >= 48 else 0.75

    # Tronco central
    trunk_half = max(1.0, s * 0.050 * scale_small)
    trunk_cx = s * 0.50
    trunk_y0 = s * 0.30                # topo do tronco (dentro do sol)
    trunk_y1 = s * 0.92                # base do tronco (perto da borda)

    # Bracos: horizontal a partir do tronco, depois vertical subindo
    arm_half = max(0.9, s * 0.042 * scale_small)
    arm_offset = s * 0.145             # distancia horizontal do tronco ate o braco
    arm_horizontal_y = s * 0.62        # altura onde o braco se conecta ao tronco
    arm_top_y = s * 0.44               # topo dos bracos verticais

    # Pre-calculo dos retangulos do mandacaru
    trunk_rect = (trunk_cx - trunk_half, trunk_y0, trunk_cx + trunk_half, trunk_y1)

    left_arm_h = (trunk_cx - arm_offset - arm_half, arm_horizontal_y - arm_half,
                  trunk_cx - trunk_half, arm_horizontal_y + arm_half)
    left_arm_v = (trunk_cx - arm_offset - arm_half, arm_top_y,
                  trunk_cx - arm_offset + arm_half, arm_horizontal_y + arm_half)

    right_arm_h = (trunk_cx + trunk_half, arm_horizontal_y - arm_half,
                   trunk_cx + arm_offset + arm_half, arm_horizontal_y + arm_half)
    right_arm_v = (trunk_cx + arm_offset - arm_half, arm_top_y,
                   trunk_cx + arm_offset + arm_half, arm_horizontal_y + arm_half)

    cactus_rects = (trunk_rect, left_arm_h, left_arm_v, right_arm_h, right_arm_v)

    rows: list[bytes] = []
    for y in range(s):
        row = bytearray()
        # Gradiente vertical: cor varia com a linha y
        t_grad = y / max(1, s - 1)
        bg_color = lerp_color(BLUE_TOP, BLUE_BOT, t_grad)
        for x in range(s):
            pixel = TRANSPARENT

            if rounded_rect_contains(x, y, 0, 0, s, s, bg_r):
                pixel = bg_color

                # Sol: disco grande, amarelo gov.br
                dx = x - sun_cx
                dy = y - sun_cy
                if dx * dx + dy * dy <= sun_r2:
                    pixel = SUN

                # Mandacaru sobrepoe o sol (silhueta branca)
                for rx0, ry0, rx1, ry1 in cactus_rects:
                    if in_rect(x, y, rx0, ry0, rx1, ry1):
                        pixel = CACTUS
                        break

            row.extend(pixel)
        rows.append(bytes(row))
    return rows


def write_png(path: str, size: int) -> None:
    rows = render(size)

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    raw = b"".join(b"\x00" + r for r in rows)  # filter byte 0 por linha
    idat = zlib.compress(raw, 9)

    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


def main() -> None:
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
    out_dir = os.path.normpath(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    for size in (16, 32, 48, 128):
        path = os.path.join(out_dir, f"icon{size}.png")
        write_png(path, size)
        print(f"[seirtao] gerado {path} ({size}x{size})")

    print("[seirtao] icones gerados com sucesso.")


if __name__ == "__main__":
    main()
