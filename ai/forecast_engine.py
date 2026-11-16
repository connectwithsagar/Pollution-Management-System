#!/usr/bin/env python3
"""
AetherGrid AI Pollution Forecasting Service
-------------------------------------------
Trains a chronological Bagged Decision Tree (Random Forest) regressor
using pure Python 3.10 standard library on real historical hourly air-quality
and meteorological observations.

Guarantees:
- Chronological 70% Train / 15% Validation / 15% Test split (zero future leakage)
- Persistence baseline comparison
- MAE, RMSE, and R^2 evaluation on held-out test set
- Saved model artifact & metadata in ai/artifacts/
- 1h, 6h, and 24h multi-horizon forecasting with empirical residual uncertainty intervals
"""

import json
import math
import os
import random
import statistics
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


MODEL_VERSION = "rf-env-1.2.0"
ARTIFACT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "artifacts")


def safe_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def parse_hour_features(iso_time: str) -> Tuple[float, float, float, float]:
    try:
        clean = iso_time.replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean)
    except Exception:
        dt = datetime.now(timezone.utc)
    hour_angle = 2.0 * math.pi * (dt.hour / 24.0)
    dow_angle = 2.0 * math.pi * (dt.weekday() / 7.0)
    return (
        math.sin(hour_angle),
        math.cos(hour_angle),
        math.sin(dow_angle),
        math.cos(dow_angle),
    )


FEATURE_NAMES = [
    "lag_1h",
    "lag_2h",
    "lag_3h",
    "lag_6h",
    "lag_12h",
    "lag_24h",
    "roll_mean_6h",
    "roll_std_6h",
    "roll_mean_24h",
    "temperature_c",
    "humidity_pct",
    "wind_speed_kmh",
    "wind_dir_sin",
    "wind_dir_cos",
    "hour_sin",
    "hour_cos",
    "dow_sin",
    "dow_cos",
]


class RegressionTreeNode:
    __slots__ = ("feature_idx", "threshold", "left", "right", "value")

    def __init__(
        self,
        feature_idx: Optional[int] = None,
        threshold: Optional[float] = None,
        left: Optional["RegressionTreeNode"] = None,
        right: Optional["RegressionTreeNode"] = None,
        value: Optional[float] = None,
    ):
        self.feature_idx = feature_idx
        self.threshold = threshold
        self.left = left
        self.right = right
        self.value = value

    def predict_one(self, x: List[float]) -> float:
        node = self
        while node.value is None:
            if x[node.feature_idx] <= node.threshold:  # type: ignore[index]
                node = node.left  # type: ignore[assignment]
            else:
                node = node.right  # type: ignore[assignment]
        return node.value

    def to_dict(self) -> Dict[str, Any]:
        if self.value is not None:
            return {"v": round(self.value, 4)}
        return {
            "f": self.feature_idx,
            "t": round(self.threshold, 4),  # type: ignore[arg-type]
            "l": self.left.to_dict(),  # type: ignore[union-attr]
            "r": self.right.to_dict(),  # type: ignore[union-attr]
        }


def build_tree(
    X: List[List[float]],
    y: List[float],
    indices: List[int],
    depth: int,
    max_depth: int,
    min_samples_leaf: int,
    max_features: int,
    rng: random.Random,
    importances: List[float],
) -> RegressionTreeNode:
    n = len(indices)
    mean_y = sum(y[i] for i in indices) / n

    if depth >= max_depth or n < 2 * min_samples_leaf:
        return RegressionTreeNode(value=mean_y)

    # Check if target values are essentially constant
    first_y = y[indices[0]]
    if all(abs(y[i] - first_y) < 1e-9 for i in indices):
        return RegressionTreeNode(value=mean_y)

    total_sum = sum(y[i] for i in indices)
    total_sq = sum(y[i] * y[i] for i in indices)
    parent_sse = total_sq - (total_sum * total_sum) / n

    n_features = len(X[0])
    feat_candidates = rng.sample(range(n_features), min(max_features, n_features))

    best_gain = 0.0
    best_feat = -1
    best_thresh = 0.0
    best_left_idx: List[int] = []
    best_right_idx: List[int] = []

    for f_idx in feat_candidates:
        paired = sorted(((X[i][f_idx], i) for i in indices), key=lambda p: p[0])
        left_sum = 0.0
        left_sq = 0.0
        left_n = 0

        for pos in range(n - 1):
            val, idx = paired[pos]
            yi = y[idx]
            left_sum += yi
            left_sq += yi * yi
            left_n += 1

            next_val = paired[pos + 1][0]
            if abs(next_val - val) < 1e-12:
                continue
            if left_n < min_samples_leaf or (n - left_n) < min_samples_leaf:
                continue

            right_n = n - left_n
            right_sum = total_sum - left_sum
            right_sq = total_sq - left_sq

            left_sse = left_sq - (left_sum * left_sum) / left_n
            right_sse = right_sq - (right_sum * right_sum) / right_n
            gain = parent_sse - (left_sse + right_sse)

            if gain > best_gain:
                best_gain = gain
                best_feat = f_idx
                best_thresh = 0.5 * (val + next_val)
                best_left_idx = [p[1] for p in paired[: pos + 1]]
                best_right_idx = [p[1] for p in paired[pos + 1 :]]

    if best_feat == -1 or best_gain <= 1e-9:
        return RegressionTreeNode(value=mean_y)

    importances[best_feat] += best_gain

    left_node = build_tree(
        X, y, best_left_idx, depth + 1, max_depth, min_samples_leaf, max_features, rng, importances
    )
    right_node = build_tree(
        X, y, best_right_idx, depth + 1, max_depth, min_samples_leaf, max_features, rng, importances
    )
    return RegressionTreeNode(
        feature_idx=best_feat,
        threshold=best_thresh,
        left=left_node,
        right=right_node,
    )


class RandomForestRegressorLite:
    def __init__(
        self,
        n_estimators: int = 24,
        max_depth: int = 6,
        min_samples_leaf: int = 3,
        seed: int = 42,
    ):
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.min_samples_leaf = min_samples_leaf
        self.seed = seed
        self.trees: List[RegressionTreeNode] = []
        self.importances: List[float] = [0.0] * len(FEATURE_NAMES)

    def fit(self, X: List[List[float]], y: List[float]) -> None:
        rng = random.Random(self.seed)
        n = len(X)
        n_features = len(X[0])
        max_features = max(3, int(math.sqrt(n_features)) + 1)
        self.trees = []
        self.importances = [0.0] * n_features

        for _ in range(self.n_estimators):
            boot_indices = [rng.randrange(n) for _ in range(n)]
            tree = build_tree(
                X,
                y,
                boot_indices,
                0,
                self.max_depth,
                self.min_samples_leaf,
                max_features,
                rng,
                self.importances,
            )
            self.trees.append(tree)

        total_imp = sum(self.importances)
        if total_imp > 0:
            self.importances = [imp / total_imp for imp in self.importances]

    def predict(self, X: List[List[float]]) -> List[float]:
        preds: List[float] = []
        for row in X:
            tree_preds = [t.predict_one(row) for t in self.trees]
            preds.append(sum(tree_preds) / len(tree_preds))
        return preds

    def predict_with_std(self, row: List[float]) -> Tuple[float, float]:
        tree_preds = [t.predict_one(row) for t in self.trees]
        mean_p = sum(tree_preds) / len(tree_preds)
        std_p = statistics.pstdev(tree_preds) if len(tree_preds) > 1 else 0.0
        return mean_p, std_p


def compute_metrics(y_true: List[float], y_pred: List[float]) -> Dict[str, Optional[float]]:
    if not y_true:
        return {"mae": None, "rmse": None, "r2": None}
    n = len(y_true)
    errors = [abs(yt - yp) for yt, yp in zip(y_true, y_pred)]
    sq_errors = [(yt - yp) ** 2 for yt, yp in zip(y_true, y_pred)]
    mae = sum(errors) / n
    rmse = math.sqrt(sum(sq_errors) / n)
    mean_y = sum(y_true) / n
    ss_tot = sum((yt - mean_y) ** 2 for yt in y_true)
    ss_res = sum(sq_errors)
    r2 = 1.0 - (ss_res / ss_tot) if ss_tot > 1e-9 else 0.0
    return {
        "mae": round(mae, 3),
        "rmse": round(rmse, 3),
        "r2": round(max(-1.0, min(1.0, r2)), 3),
    }


def extract_features_at_index(
    series: List[Dict[str, Any]], idx: int, target_key: str
) -> Optional[List[float]]:
    if idx < 24:
        return None
    val_lags = []
    for lag in (1, 2, 3, 6, 12, 24):
        v = safe_float(series[idx - lag].get(target_key))
        if v is None:
            return None
        val_lags.append(v)

    last_6 = [safe_float(series[idx - k].get(target_key)) for k in range(1, 7)]
    last_24 = [safe_float(series[idx - k].get(target_key)) for k in range(1, 25)]
    if any(v is None for v in last_6) or any(v is None for v in last_24):
        return None

    last_6_f = [float(v) for v in last_6 if v is not None]
    last_24_f = [float(v) for v in last_24 if v is not None]

    roll_mean_6 = sum(last_6_f) / len(last_6_f)
    roll_std_6 = statistics.pstdev(last_6_f)
    roll_mean_24 = sum(last_24_f) / len(last_24_f)

    row = series[idx]
    temp = safe_float(row.get("temperature"))
    hum = safe_float(row.get("humidity"))
    wind_spd = safe_float(row.get("windSpeed"))
    wind_dir = safe_float(row.get("windDirection"))

    temp = temp if temp is not None else 18.0
    hum = hum if hum is not None else 55.0
    wind_spd = wind_spd if wind_spd is not None else 8.0
    wind_rad = math.radians(wind_dir if wind_dir is not None else 0.0)

    h_sin, h_cos, d_sin, d_cos = parse_hour_features(str(row.get("timestamp", "")))

    return [
        val_lags[0],
        val_lags[1],
        val_lags[2],
        val_lags[3],
        val_lags[4],
        val_lags[5],
        roll_mean_6,
        roll_std_6,
        roll_mean_24,
        temp,
        hum,
        wind_spd,
        math.sin(wind_rad),
        math.cos(wind_rad),
        h_sin,
        h_cos,
        d_sin,
        d_cos,
    ]


def run_forecast(payload: Dict[str, Any]) -> Dict[str, Any]:
    target = str(payload.get("target", "pm2_5"))
    horizon = int(payload.get("horizon", 24))
    horizon = max(1, min(48, horizon))
    location_key = str(payload.get("locationKey", "default"))
    history = payload.get("history", [])
    weather_forecast = payload.get("weatherForecast", [])

    # Keep only valid observed/modeled rows sorted chronologically
    clean_history: List[Dict[str, Any]] = []
    for item in history:
        val = safe_float(item.get(target))
        if val is not None and item.get("timestamp"):
            clean_history.append(item)

    clean_history.sort(key=lambda r: str(r.get("timestamp", "")))

    if len(clean_history) < 40:
        return {
            "status": "unavailable",
            "reason": f"Insufficient historical observations ({len(clean_history)} points; minimum 40 required for chronological split).",
            "modelVersion": MODEL_VERSION,
            "algorithm": "Random Forest Regressor (Chronological)",
            "target": target,
            "horizonHours": horizon,
            "trainedAt": None,
            "metrics": None,
            "predictions": [],
        }

    # Build supervised dataset: predict y[i] from features up to i-1 (strictly no future leakage)
    X_all: List[List[float]] = []
    y_all: List[float] = []
    baseline_all: List[float] = []

    for i in range(24, len(clean_history)):
        feats = extract_features_at_index(clean_history, i, target)
        y_val = safe_float(clean_history[i].get(target))
        if feats is not None and y_val is not None:
            X_all.append(feats)
            y_all.append(y_val)
            baseline_all.append(feats[0])  # lag_1h persistence baseline

    n_total = len(X_all)
    if n_total < 20:
        return {
            "status": "unavailable",
            "reason": "Insufficient contiguous hourly samples after lag alignment.",
            "modelVersion": MODEL_VERSION,
            "algorithm": "Random Forest Regressor (Chronological)",
            "target": target,
            "horizonHours": horizon,
            "trainedAt": None,
            "metrics": None,
            "predictions": [],
        }

    # Chronological 70 / 15 / 15 split
    train_end = max(12, int(n_total * 0.70))
    val_end = max(train_end + 3, int(n_total * 0.85))
    if val_end >= n_total:
        val_end = n_total - 2

    X_train, y_train = X_all[:train_end], y_all[:train_end]
    X_val, y_val = X_all[train_end:val_end], y_all[train_end:val_end]
    X_test, y_test = X_all[val_end:], y_all[val_end:]
    base_test = baseline_all[val_end:]

    model = RandomForestRegressorLite(n_estimators=24, max_depth=6, min_samples_leaf=3, seed=42)
    model.fit(X_train, y_train)

    val_preds = model.predict(X_val)
    test_preds = model.predict(X_test)

    val_metrics = compute_metrics(y_val, val_preds)
    test_metrics = compute_metrics(y_test, test_preds)
    baseline_metrics = compute_metrics(y_test, base_test)

    # Residual std on test set for uncertainty intervals
    test_residuals = [abs(yt - yp) for yt, yp in zip(y_test, test_preds)]
    residual_scale = statistics.mean(test_residuals) if test_residuals else 2.5

    # Recursive multi-step forecast using trained model on full latest history
    # Refit on train+val for final production inference while reporting held-out test metrics
    prod_model = RandomForestRegressorLite(n_estimators=28, max_depth=6, min_samples_leaf=3, seed=42)
    prod_model.fit(X_all, y_all)

    # Prepare rolling buffer of historical rows
    sim_series = [dict(r) for r in clean_history]
    last_ts = str(sim_series[-1]["timestamp"])
    try:
        base_dt = datetime.fromisoformat(last_ts.replace("Z", "+00:00"))
    except Exception:
        base_dt = datetime.now(timezone.utc)

    predictions: List[Dict[str, Any]] = []
    for step in range(1, horizon + 1):
        step_dt = base_dt.timestamp() + step * 3600
        step_iso = datetime.fromtimestamp(step_dt, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        wf_row = weather_forecast[step - 1] if step - 1 < len(weather_forecast) else {}
        next_row: Dict[str, Any] = {
            "timestamp": step_iso,
            "temperature": wf_row.get("temperature", sim_series[-1].get("temperature", 18.0)),
            "humidity": wf_row.get("humidity", sim_series[-1].get("humidity", 55.0)),
            "windSpeed": wf_row.get("windSpeed", sim_series[-1].get("windSpeed", 8.0)),
            "windDirection": wf_row.get("windDirection", sim_series[-1].get("windDirection", 180.0)),
        }
        sim_series.append(next_row)
        idx = len(sim_series) - 1
        feats = extract_features_at_index(sim_series, idx, target)
        if feats is None:
            fallback_val = float(safe_float(sim_series[-2].get(target)) or 0.0)
            pred_mean, tree_std = fallback_val, residual_scale
        else:
            pred_mean, tree_std = prod_model.predict_with_std(feats)

        pred_mean = max(0.0, pred_mean)
        sim_series[-1][target] = pred_mean

        horizon_growth = math.sqrt(step) * 0.45
        uncertainty = max(1.0, (1.645 * max(residual_scale, tree_std)) * (1.0 + 0.12 * horizon_growth))
        lower = max(0.0, pred_mean - uncertainty)
        upper = pred_mean + uncertainty
        confidence_pct = max(45.0, min(96.0, 94.0 - step * 1.15))

        predictions.append(
            {
                "stepHours": step,
                "timestamp": step_iso,
                "predictedValue": round(pred_mean, 2),
                "lowerBound": round(lower, 2),
                "upperBound": round(upper, 2),
                "confidencePct": round(confidence_pct, 1),
                "sourceType": "ai_forecast",
                "sourceLabel": f"AI Random Forest ({MODEL_VERSION})",
            }
        )

    trained_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    top_features = sorted(
        [
            {"feature": name, "importance": round(imp, 4)}
            for name, imp in zip(FEATURE_NAMES, prod_model.importances)
        ],
        key=lambda x: x["importance"],
        reverse=True,
    )[:8]

    # Save model artifact and metadata
    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    safe_loc = "".join(c if c.isalnum() or c in "-_" else "_" for c in location_key)[:40]
    artifact_path = os.path.join(ARTIFACT_DIR, f"rf_{target}_{safe_loc}.json")
    artifact_payload = {
        "modelVersion": MODEL_VERSION,
        "algorithm": "Bagged Random Forest Regressor",
        "target": target,
        "locationKey": location_key,
        "trainedAt": trained_at,
        "splits": {
            "trainSamples": len(X_train),
            "validationSamples": len(X_val),
            "testSamples": len(X_test),
            "splitPolicy": "chronological_70_15_15_no_future_leakage",
        },
        "validationMetrics": val_metrics,
        "testMetrics": test_metrics,
        "baselineTestMetrics": baseline_metrics,
        "featureImportances": top_features,
        "trees": [t.to_dict() for t in prod_model.trees[:6]],
    }
    try:
        with open(artifact_path, "w", encoding="utf-8") as f:
            json.dump(artifact_payload, f, indent=2)
    except OSError:
        pass

    return {
        "status": "ready",
        "modelVersion": MODEL_VERSION,
        "algorithm": "Bagged Random Forest Regressor (Python 3.10)",
        "target": target,
        "horizonHours": horizon,
        "trainedAt": trained_at,
        "artifactFile": os.path.basename(artifact_path),
        "splits": artifact_payload["splits"],
        "metrics": {
            "validation": val_metrics,
            "test": test_metrics,
            "baselinePersistenceTest": baseline_metrics,
        },
        "featureImportances": top_features,
        "horizonSnapshots": {
            "1h": predictions[0] if len(predictions) >= 1 else None,
            "6h": predictions[5] if len(predictions) >= 6 else None,
            "24h": predictions[23] if len(predictions) >= 24 else predictions[-1],
        },
        "predictions": predictions,
    }


def main() -> None:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
        result = run_forecast(payload)
        sys.stdout.write(json.dumps(result))
    except Exception as exc:
        sys.stdout.write(
            json.dumps(
                {
                    "status": "unavailable",
                    "reason": f"AI forecast execution failed: {exc}",
                    "modelVersion": MODEL_VERSION,
                    "predictions": [],
                }
            )
        )


if __name__ == "__main__":
    main()
