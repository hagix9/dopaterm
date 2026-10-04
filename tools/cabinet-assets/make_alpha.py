"""dopa.jpeg の市松模様（透過表現の代用）を除去し、筐体だけのアルファ PNG を作る。

方針:
  - 開口部（上部のターミナル窓 / 下部 3 つのリール窓）は矩形ごと完全に透過させる。
    枠は矩形の外側にあるので、筐体の锻造・reflection は壊さない。
  - 筐体外側の市松模様は画像外周から flood fill し、「外周につながっている背景」だけを
    除去する。筐体内部の desaturated な高光（クロームの反射）には触れない。
  - 元の dopa.jpeg は上書きしない。
"""
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

SRC = "dopa-real/dopa.jpeg"
OUT = "client/assets/cabinet/dopa-cabinet.png"
OUT_META = "client/assets/cabinet/dopa-cabinet.json"

# 実測した開口部（画像座標 px, x0,y0,x1,y1）
OPENINGS = {
    "terminal": (203, 118, 821, 334),
    "reelL": (204, 356, 414, 467),
    "reelC": (435, 356, 586, 468),
    "reelR": (606, 356, 821, 468),
}

im = Image.open(SRC).convert("RGB")
a = np.asarray(im).astype(np.int16)
H, W = a.shape[:2]

mx = a.max(axis=2)
mn = a.min(axis=2)
sat = mx - mn

# --- 1) 開口部を矩形で完全に透過させる -------------------------------------
open_mask = np.zeros((H, W), bool)
for (x0, y0, x1, y1) in OPENINGS.values():
    open_mask[y0:y1, x0:x1] = True

# --- 2) 筐体外側の背景を除去 -----------------------------------------------
# 市松模様そのものを厳密に判定し、さらに「画像外周につながっている成分」だけを取る。
# これで筐体自身の低彩度な面（トップレール等）は不会被 wont 削られない。
# JPEG のにじみ分だけ 1px 拡張して、枠の外側に灰色の縁を残さない。
mx_i, mn_i = mx.astype(np.int16), mn.astype(np.int16)
tight = (mx_i - mn_i <= 12) & (mx_i >= 120) & (mx_i <= 235)
lab, _ = ndimage.label(tight)
border_labels = set()
for edge in (lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]):
    border_labels.update(int(v) for v in np.unique(edge) if v != 0)
if not border_labels:
    sys.exit("外周の背景成分が見つからない")
outer_bg = ndimage.binary_dilation(np.isin(lab, list(border_labels)), iterations=1)

alpha = np.full((H, W), 255, np.uint8)
alpha[open_mask | outer_bg] = 0

# --- 3) 輸出 -------------------------------------------------------------
rgba = np.dstack([a.astype(np.uint8), alpha])

Image.fromarray(rgba, "RGBA").save(OUT, optimize=True)

meta = {
    "source": SRC,
    "sourceSize": [W, H],
    "canvas": [W, H],
    "openings": {k: {"x": v[0], "y": v[1], "w": v[2] - v[0], "h": v[3] - v[1]} for k, v in OPENINGS.items()},
}
with open(OUT_META, "w") as f:
    json.dump(meta, f, indent=2)

print("wrote", OUT)
print(json.dumps(meta["openings"], indent=2))
print("transparent px: %.1f%%" % (100 * (alpha == 0).mean()))
