"""Remove solid backgrounds from logo / kobo / drone and save as transparent PNGs."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets"


def flood_clear(img: Image.Image, targets: list[tuple[int, int, int]], tol: int) -> Image.Image:
    """Flood-fill from edges for pixels close to any target RGB, making them transparent."""
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    visited = [[False] * h for _ in range(w)]
    stack: list[tuple[int, int]] = []

    def near(c: tuple[int, int, int, int]) -> bool:
        r, g, b, a = c
        if a == 0:
            return True
        for tr, tg, tb in targets:
            if abs(r - tr) <= tol and abs(g - tg) <= tol and abs(b - tb) <= tol:
                return True
        return False

    for x in range(w):
        stack.append((x, 0))
        stack.append((x, h - 1))
    for y in range(h):
        stack.append((0, y))
        stack.append((w - 1, y))

    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h or visited[x][y]:
            continue
        visited[x][y] = True
        if not near(px[x, y]):
            continue
        px[x, y] = (0, 0, 0, 0)
        stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    # Second pass: clear remaining near-target pixels that are mostly background noise
    # only when alpha neighbors are transparent (soft edge cleanup)
    for x in range(w):
        for y in range(h):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if not near((r, g, b, a)):
                continue
            # Only wipe interior-ish bg if surrounded by transparent or bg-like pixels
            neighbors = 0
            transparent = 0
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h:
                    neighbors += 1
                    nr, ng, nb, na = px[nx, ny]
                    if na == 0 or near((nr, ng, nb, na)):
                        transparent += 1
            if neighbors and transparent == neighbors:
                px[x, y] = (0, 0, 0, 0)

    return rgba


def process(src: Path, dest: Path, mode: str) -> None:
    img = Image.open(src)
    if mode == "black":
        out = flood_clear(img, [(0, 0, 0), (5, 5, 5), (10, 10, 10)], tol=28)
    elif mode == "white":
        out = flood_clear(img, [(255, 255, 255), (250, 250, 250), (245, 245, 245), (240, 240, 240)], tol=32)
    else:
        raise ValueError(mode)
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "PNG")
    print(f"OK {src.name} -> {dest.relative_to(ROOT)} ({out.size[0]}x{out.size[1]})")


def main() -> None:
    process(ASSETS / "ui" / "logo.png", ASSETS / "ui" / "logo.png", "black")
    process(ASSETS / "chars" / "kobo.jpg", ASSETS / "chars" / "kobo.png", "white")
    process(ASSETS / "chars" / "drone.jpg", ASSETS / "chars" / "drone.png", "black")


if __name__ == "__main__":
    main()
