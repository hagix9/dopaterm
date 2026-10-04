"""dopa.jpeg を 4 倍 (4096x2560) に高解像度化し、透過 PNG を作る。

AI アップスケーラーは環境に存在しないため、古典的パイプラインで構成する:
  1) edgePreservingFilter で JPEG のブロック/モスキートノイズを抑える
     (エッジは保持するのでメッキの輪郭・文字の形は変えない)
  2) INTER_LANCZOS4 で 4x アップスケール
  3) アンシャープマスクでエッジのコントラストを補償
     (新しい細部を「生成」するものではなく、既存の輪郭を保つ処理)

透過処理は make_alpha.py と同じ規則を 4x 座標で適用する:
  - 開口部は矩形ごと完全透過 (枠は矩形の外側なので装飾を壊さない)
  - 外周の市松模様は「無彩色・中間調」かつ「画像外周に接する連結成分」のみ除去
  - JPEG 由来の色にじみ分だけマスクを内側へ食い込ませ、アルファ縁を
    1px ガウスでアンチエイリアスしてギザギザを防ぐ

元の dopa.jpeg / dopa-cabinet.png は上書きしない。
"""
import argparse
import json
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

SCALE = 4

# make_alpha.py の実測値 (1024x640 基準) を SCALE 倍
OPENINGS_1X = {
    "terminal": (203, 118, 821, 334),
    "reelL": (204, 356, 414, 467),
    "reelC": (435, 356, 586, 468),
    "reelR": (606, 356, 821, 468),
}
OPENINGS = {k: tuple(v * SCALE for v in r) for k, r in OPENINGS_1X.items()}


def enhance(bgr: np.ndarray) -> np.ndarray:
    # 1) エッジ保持スムージングで JPEG ノイズを除去 (sigma_r を小さく保ち
    #    クロームの明暗差は潰さない)
    den = cv2.edgePreservingFilter(bgr, flags=cv2.RECURS_FILTER, sigma_s=60, sigma_r=0.25)
    # 2) 4x Lanczos リサンプル
    h, w = den.shape[:2]
    up = cv2.resize(den, (w * SCALE, h * SCALE), interpolation=cv2.INTER_LANCZOS4)
    # 3) アンシャープマスク (半径=2px@4x, 量は控えめ)
    blur = cv2.GaussianBlur(up, (0, 0), sigmaX=2.0)
    return cv2.addWeighted(up, 1.5, blur, -0.5, 0)


def build_alpha(rgb: np.ndarray) -> np.ndarray:
    h, w = rgb.shape[:2]
    mx = rgb.max(axis=2).astype(np.int16)
    mn = rgb.min(axis=2).astype(np.int16)

    open_mask = np.zeros((h, w), bool)
    for x0, y0, x1, y1 in OPENINGS.values():
        open_mask[y0:y1, x0:x1] = True

    # 市松は無彩色で 120-235 の中間調。外周に接する成分だけを除去する。
    tight = (mx - mn <= 12) & (mx >= 110) & (mx <= 240)
    lab, _ = ndimage.label(tight)
    border_labels = set()
    for edge in (lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]):
        border_labels.update(int(v) for v in np.unique(edge) if v != 0)
    if not border_labels:
        sys.exit("外周の背景成分が見つからない")
    outer_bg = np.isin(lab, list(border_labels))
    # 市松のにじみが筐体側へ残るのを防ぐため、1x 換算 1px 分だけ内側へ食い込ませる
    outer_bg = ndimage.binary_dilation(outer_bg, iterations=SCALE)

    alpha = np.full((h, w), 255, np.uint8)
    alpha[open_mask | outer_bg] = 0
    # アルファ縁のアンチエイリアス (ギザギザ・白/黒縁を防ぐ)
    alpha = cv2.GaussianBlur(alpha, (0, 0), sigmaX=1.0)
    return alpha


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--meta", default=None)
    args = ap.parse_args()

    bgr = cv2.imread(args.src, cv2.IMREAD_COLOR)
    if bgr is None:
        sys.exit(f"読めない: {args.src}")
    src_h, src_w = bgr.shape[:2]

    up = enhance(bgr)
    rgb = cv2.cvtColor(up, cv2.COLOR_BGR2RGB)
    alpha = build_alpha(rgb)
    rgba = np.dstack([rgb, alpha])

    Image.fromarray(rgba, "RGBA").save(args.out, optimize=True)

    if args.meta:
        h, w = rgba.shape[:2]
        meta = {
            "source": args.src,
            "sourceSize": [src_w, src_h],
            "canvas": [w, h],
            "scale": SCALE,
            "pipeline": "edgePreservingFilter + INTER_LANCZOS4 4x + unsharp(0.5, r=2)",
            "openings": {
                k: {"x": v[0], "y": v[1], "w": v[2] - v[0], "h": v[3] - v[1]}
                for k, v in OPENINGS.items()
            },
        }
        with open(args.meta, "w") as f:
            json.dump(meta, f, indent=2)
        print(json.dumps(meta["openings"]))
    print("transparent px: %.1f%%" % (100 * (alpha < 128).mean()))
    print("wrote", args.out)


if __name__ == "__main__":
    main()
