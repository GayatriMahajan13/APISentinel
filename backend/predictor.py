"""Load the saved XGBoost model once and score feature rows."""

from __future__ import annotations

import json
import pickle
from pathlib import Path

import numpy as np

from features import FEATURE_ORDER, extract_features, features_to_row

ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "models"
MODEL_PATH = MODELS_DIR / "apisentinel_model.pkl"
FEATURES_PATH = MODELS_DIR / "apisentinel_features.pkl"
INFO_PATH = MODELS_DIR / "apisentinel_model_info.json"
LIBOMP_PATH = ROOT / "vendor" / "libomp" / "libomp.dylib"


def _openmp_hint() -> str:
    return (
        "XGBoost needs OpenMP (libomp) on this Mac. Start the app with ./run.sh "
        f"so DYLD_LIBRARY_PATH includes {LIBOMP_PATH.parent}."
    )

# CSIC-2010 student notebooks almost always use 0 = normal, 1 = anomalous.
LABEL_NAMES = {0: "normal", 1: "anomalous"}


class SentinelModel:
    def __init__(self) -> None:
        with FEATURES_PATH.open("rb") as handle:
            stored_features = pickle.load(handle)
        if list(stored_features) != FEATURE_ORDER:
            raise ValueError(
                f"Feature file order {stored_features} does not match {FEATURE_ORDER}"
            )

        try:
            with MODEL_PATH.open("rb") as handle:
                self.model = pickle.load(handle)
        except Exception as exc:
            raise RuntimeError(f"Could not load the XGBoost model. {_openmp_hint()} Details: {exc}") from exc

        with INFO_PATH.open("r", encoding="utf-8") as handle:
            self.info = json.load(handle)

        self.feature_names = list(stored_features)

    def predict_from_request(self, url: str, payload: str = "") -> dict:
        values = extract_features(url=url, payload=payload)
        return self.predict_from_features(values)

    def predict_from_features(self, values: dict[str, float]) -> dict:
        row = features_to_row(values, self.feature_names)
        array = np.array([row], dtype=float)
        class_id = int(self.model.predict(array)[0])
        probabilities = self.model.predict_proba(array)[0]
        confidence = float(probabilities[class_id])
        return {
            "prediction": LABEL_NAMES.get(class_id, str(class_id)),
            "class_id": class_id,
            "confidence": confidence,
            "probabilities": {
                LABEL_NAMES.get(i, str(i)): float(p) for i, p in enumerate(probabilities)
            },
            "features": {name: values[name] for name in self.feature_names},
        }


sentinel_model: SentinelModel | None = None


def get_model() -> SentinelModel:
    global sentinel_model
    if sentinel_model is None:
        sentinel_model = SentinelModel()
    return sentinel_model
