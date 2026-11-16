"""Institutional research utilities used by the paper-trading backend.

The functions in this module operate on plain Python sequences and mappings so
that research jobs can be tested independently from FastAPI and SQLite.
"""

from itertools import combinations
from math import ceil
from typing import Iterable, Sequence


def triple_barrier_labels(
    prices: Sequence[float],
    sides: Sequence[int],
    horizons: Sequence[int],
    profit_taking: float,
    stop_loss: float,
) -> list[dict]:
    """Label each event by the first barrier touched.

    ``sides`` should contain 1 for long and -1 for short events. Horizons are
    measured in bars. A label is 1 when the side's profit target is touched,
    -1 when its stop is touched, and 0 when the vertical barrier wins.
    """
    if len(prices) != len(sides) or len(prices) != len(horizons):
        raise ValueError("prices, sides, and horizons must have equal lengths")
    if profit_taking <= 0 or stop_loss <= 0:
        raise ValueError("profit_taking and stop_loss must be positive")

    labels = []
    for start, (entry, side, horizon) in enumerate(zip(prices, sides, horizons)):
        if entry <= 0 or side not in (-1, 1) or horizon < 0:
            raise ValueError("entry prices must be positive, sides must be ±1, and horizons non-negative")
        end = min(len(prices) - 1, start + horizon)
        label = 0
        exit_index = end
        for index in range(start + 1, end + 1):
            return_value = side * (prices[index] / entry - 1)
            if return_value >= profit_taking:
                label, exit_index = 1, index
                break
            if return_value <= -stop_loss:
                label, exit_index = -1, index
                break
        labels.append({"start": start, "end": exit_index, "label": label, "return": side * (prices[exit_index] / entry - 1)})
    return labels


def meta_labels(primary_side: Sequence[int], realized_returns: Sequence[float]) -> list[int]:
    """Return 1 when a primary model's direction was profitable, otherwise 0."""
    if len(primary_side) != len(realized_returns):
        raise ValueError("primary_side and realized_returns must have equal lengths")
    return [int(side in (-1, 1) and side * result > 0) for side, result in zip(primary_side, realized_returns)]


class PurgedKFold:
    """K-fold splitter that removes training observations overlapping test events."""

    def __init__(self, n_splits: int = 5, embargo: int = 0):
        if n_splits < 2 or embargo < 0:
            raise ValueError("n_splits must be >= 2 and embargo must be non-negative")
        self.n_splits = n_splits
        self.embargo = embargo

    def split(self, event_starts: Sequence[int], event_ends: Sequence[int]):
        if len(event_starts) != len(event_ends):
            raise ValueError("event_starts and event_ends must have equal lengths")
        n = len(event_starts)
        if n < self.n_splits:
            raise ValueError("not enough events for n_splits")
        folds = [list(range(start, min(start + ceil(n / self.n_splits), n))) for start in range(0, n, ceil(n / self.n_splits))]
        folds = folds[: self.n_splits]
        for test in folds:
            test_start = min(event_starts[i] for i in test)
            test_end = max(event_ends[i] for i in test)
            embargo_end = test_end + self.embargo
            train = [i for i in range(n) if i not in test and (event_ends[i] < test_start or event_starts[i] > embargo_end)]
            yield train, test


def cpcv_splits(n_samples: int, n_groups: int = 6, test_groups: int = 2) -> Iterable[tuple[list[int], list[int]]]:
    """Generate combinatorial purged cross-validation group splits."""
    if n_groups < 2 or not 1 <= test_groups < n_groups or n_samples < n_groups:
        raise ValueError("invalid CPCV parameters")
    group_size = ceil(n_samples / n_groups)
    groups = [list(range(i, min(i + group_size, n_samples))) for i in range(0, n_samples, group_size)][:n_groups]
    for selected in combinations(range(n_groups), test_groups):
        test = [index for group in selected for index in groups[group]]
        train = [index for group in range(n_groups) if group not in selected for index in groups[group]]
        yield train, test


def uniqueness_weights(event_starts: Sequence[int], event_ends: Sequence[int]) -> list[float]:
    """Calculate average uniqueness (inverse concurrency) for each event."""
    if len(event_starts) != len(event_ends):
        raise ValueError("event_starts and event_ends must have equal lengths")
    if any(start < 0 or end < start for start, end in zip(event_starts, event_ends)):
        raise ValueError("event intervals must be non-negative and ordered")
    concurrency = {}
    for start, end in zip(event_starts, event_ends):
        for timestamp in range(start, end + 1):
            concurrency[timestamp] = concurrency.get(timestamp, 0) + 1
    weights = []
    for start, end in zip(event_starts, event_ends):
        values = [1 / concurrency[timestamp] for timestamp in range(start, end + 1)]
        weights.append(sum(values) / len(values) if values else 0.0)
    return weights


def sequential_bootstrap(event_starts: Sequence[int], event_ends: Sequence[int], sample_size: int, seed: int | None = None) -> list[int]:
    """Select events greedily by maximum marginal average uniqueness."""
    if sample_size < 0 or sample_size > len(event_starts):
        raise ValueError("sample_size must be between zero and the number of events")
    if len(event_starts) != len(event_ends):
        raise ValueError("event_starts and event_ends must have equal lengths")
    del seed  # deterministic by design; callers can randomize ties upstream.
    selected = []
    remaining = set(range(len(event_starts)))
    for _ in range(sample_size):
        best = max(remaining, key=lambda candidate: _marginal_uniqueness(candidate, selected, event_starts, event_ends))
        selected.append(best)
        remaining.remove(best)
    return selected


def _marginal_uniqueness(candidate, selected, starts, ends):
    intervals = selected + [candidate]
    return sum(uniqueness_weights([starts[i] for i in intervals], [ends[i] for i in intervals])) / len(intervals)


FEATURES = [
    "triple_barrier_labeling",
    "meta_labeling",
    "purged_kfold",
    "cpcv",
    "sequential_bootstrap",
    "uniqueness_weights",
]
