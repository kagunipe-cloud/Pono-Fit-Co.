#!/usr/bin/env python3
"""
Export Kaggle gym-exercises-dataset to JSON for The-Fox-Says exercise import.

Install: pip install kagglehub[pandas-datasets]
Kaggle: ensure you're logged in (kaggle credentials or KAGGLE_USERNAME/KAGGLE_KEY).

Run from repo root: python scripts/export_kaggle_gym_exercises.py
Output: gym-exercises-export.json (paste into Exercises → Import CSV or JSON).
"""

import json
import os

import pandas as pd
try:
    import kagglehub
    from kagglehub import KaggleDatasetAdapter
except ImportError:
    print("Run: pip install kagglehub[pandas-datasets]")
    raise

# Dataset and output path
DATASET_OWNER_SLUG = "rishitmurarka/gym-exercises-dataset"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(SCRIPT_DIR, "..", "gym-exercises-export.json")


def main():
    # Load dataset (empty file_path = first/default file, often a CSV)
    print(f"Loading {DATASET_OWNER_SLUG}...")
    df = kagglehub.load_dataset(
        KaggleDatasetAdapter.PANDAS,
        DATASET_OWNER_SLUG,
        "",  # first file in dataset
    )
    print(f"Loaded {len(df)} rows. Columns: {list(df.columns)}")

    # Normalize column names (different Kaggle datasets use different casing)
    cols = {c.strip().lower(): c for c in df.columns}
    title_col = cols.get("title") or cols.get("name") or df.columns[0]
    body_col = cols.get("bodypart") or cols.get("body_part") or cols.get("target")
    equip_col = cols.get("equipment")
    type_col = cols.get("type") or cols.get("category")

    out = []
    for _, row in df.iterrows():
        name = str(row.get(title_col, "")).strip()
        if not name:
            continue
        obj = {
            "name": name,
            "title": name,
        }
        if body_col and body_col in row and pd.notna(row[body_col]):
            obj["bodyPart"] = str(row[body_col]).strip()
        if equip_col and equip_col in row and pd.notna(row[equip_col]):
            obj["equipment"] = str(row[equip_col]).strip()
        if type_col and type_col in row and pd.notna(row[type_col]):
            t = str(row[type_col]).strip().lower()
            obj["type"] = "cardio" if t == "cardio" else "lift"
        out.append(obj)

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(out)} exercises to {os.path.abspath(OUT_PATH)}")
    print("Next: open Exercises in the app → Import (CSV or JSON) → paste this file's contents → Import.")


if __name__ == "__main__":
    main()
