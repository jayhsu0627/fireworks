#!/usr/bin/env python3
import argparse
import json
import math
import re
import sys
from pathlib import Path
from urllib import error, request


QUESTION = (
    "Explain the statistical interpretation of a p-value. What is a p-value? "
    "What does it mean? Be sure to explain beyond just rejecting or failing to reject "
    "the null hypothesis."
)

SOLUTION = """- P-values assume the null hypothesis ("default" statement) is true, and evaluate
  the likelihood of our observed data (or more extreme data) under that assumption.
- A small p-value means the observed data would be unlikely if the null were true, so it
  is evidence against the null hypothesis.
- IMPORTANT: a small p-value does NOT mean the null hypothesis is false.
- Likewise, a large p-value does NOT prove the null is true; it means the data are not
  very incompatible with the null."""

RUBRIC = """4 points (shortcut 1):
- Core definition includes BOTH:
  1) probability of obtaining the observed result (or more extreme), AND
  2) this probability is computed assuming / given the null hypothesis is true.
- Also explains that a small p-value means the data are unlikely under H0 and thus
  provides evidence against the null hypothesis.
- Exact wording is not required; equivalent phrasing is acceptable.

2 points (shortcut 2):
- Partial understanding, including answers that:
  - mention only reject/fail-to-reject behavior without clear interpretation,
  - are missing one of the two core definition pieces above,
  - conflate p-value with alpha/significance level, or
  - claim/strongly imply p-value is probability the null is true.

0 points (shortcut 3):
- Blank, off-topic, or fundamentally incorrect with no meaningful p-value interpretation."""


SYSTEM_PROMPT = """You are a fair statistics grader.
Do not require wording to match the reference solution.
Return JSON only. No markdown, no extra text.
Output schema:
{
  "points": 4 or 2 or 0,
  "shortcut": "1" or "2" or "3",
  "feedback": "1-2 sentence rationale"
}
Rules:
- Must map points exactly to shortcut: 4->"1", 2->"2", 0->"3"
- Key ideas to detect:
  - probability of observed result (or more extreme),
  - assuming null hypothesis is true,
  - evidence against null for small p-value,
  - how likely/unlikely the data are under H0.
- Give 4 only when the first two appear together as the definition and the answer also
  communicates evidence against H0 (small p-value -> stronger evidence).
- Red flags for partial credit (usually 2):
  - "p-value is probability null hypothesis is true"
  - only reject/fail-reject language without interpretation
  - confusion between p-value and significance level alpha
- Use 0 only for blank/off-topic/fundamentally wrong answers.
- Keep feedback concise and specific"""


def render_progress(
    done: int,
    total: int,
    width: int = 30,
    mode: str = "auto",
) -> None:
    if total <= 0:
        return
    ratio = max(0.0, min(1.0, done / total))
    use_bar = mode == "bar" or (mode == "auto" and sys.stdout.isatty())
    if not use_bar:
        percent = int(ratio * 100)
        print(f"Progress: {done}/{total} ({percent}%)", flush=True)
        return
    filled = int(ratio * width)
    bar = "#" * filled + "-" * (width - filled)
    percent = int(ratio * 100)
    sys.stdout.write(f"\r[{bar}] {done}/{total} ({percent}%)")
    if done >= total:
        sys.stdout.write("\n")
    sys.stdout.flush()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Grade student p-value responses with local vLLM."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to input JSON array of student responses.",
    )
    parser.add_argument(
        "--output",
        help="Path to output graded JSON. Default: <input>-graded.json",
    )
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:8001/v1",
        help="OpenAI-compatible vLLM base URL.",
    )
    parser.add_argument(
        "--model",
        default="hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4",
        help="Model id. If omitted, script fetches the first available model from /models.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional number of records to process (for quick testing).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=120.0,
        help="HTTP timeout in seconds.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=64,
        help="Number of non-empty responses to grade per LLM request.",
    )
    parser.add_argument(
        "--progress-mode",
        choices=["auto", "bar", "plain"],
        default="auto",
        help=(
            "Progress display mode. auto=bar on TTY, plain otherwise; "
            "bar=single-line carriage return; plain=one line per update."
        ),
    )
    return parser.parse_args()


def post_json(url: str, payload: dict, timeout: float) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_json(url: str, timeout: float) -> dict:
    req = request.Request(url, method="GET")
    with request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def pick_model(base_url: str, timeout: float) -> str:
    models_url = base_url.rstrip("/") + "/models"
    payload = get_json(models_url, timeout=timeout)
    data = payload.get("data", [])
    if not data:
        raise RuntimeError(f"No models returned by {models_url}")
    model_id = data[0].get("id")
    if not model_id:
        raise RuntimeError(f"Malformed model list from {models_url}: {payload}")
    return model_id


def extract_json_payload(text: str):
    text = (text or "").strip()
    if not text:
        raise ValueError("Empty model response")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try object first, then array.
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if match:
            return json.loads(match.group(0))
        match = re.search(r"\[.*\]", text, flags=re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def normalize_grade(raw: dict) -> dict:
    points = raw.get("points")
    shortcut = raw.get("shortcut")
    feedback = str(raw.get("feedback", "")).strip()

    if points not in (0, 2, 4):
        raise ValueError(f"Invalid points from model: {points}")

    expected_shortcut = {4: "1", 2: "2", 0: "3"}[points]
    if str(shortcut) != expected_shortcut:
        shortcut = expected_shortcut

    return {
        "points": points,
        "shortcut": shortcut,
        "feedback": feedback,
    }


def grade_one_answer(
    answer_text: str,
    base_url: str,
    model: str,
    timeout: float,
) -> dict:
    user_prompt = (
        f"QUESTION:\n{QUESTION}\n\n"
        f"REFERENCE SOLUTION:\n{SOLUTION}\n\n"
        f"RUBRIC:\n{RUBRIC}\n\n"
        f"STUDENT ANSWER:\n{answer_text}\n\n"
        "Grade the student answer using the rubric and return JSON only."
    )

    payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "response_format": {"type": "json_object"},
    }
    url = base_url.rstrip("/") + "/chat/completions"
    resp = post_json(url, payload, timeout=timeout)
    content = (
        resp.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    raw_grade = extract_json_payload(content)
    return normalize_grade(raw_grade)


def grade_batch_answers(
    answer_texts: list[str],
    base_url: str,
    model: str,
    timeout: float,
) -> list[dict]:
    batch_schema = """Output schema must be a JSON array where each element is:
{
  "index": <0-based index within this batch>,
  "points": 4 or 2 or 0,
  "shortcut": "1" or "2" or "3",
  "feedback": "1-2 sentence rationale"
}
You must return exactly one element per input answer and preserve all indexes."""
    answers_blob = "\n\n".join(
        [f"INDEX {i} ANSWER:\n{text}" for i, text in enumerate(answer_texts)]
    )
    user_prompt = (
        f"QUESTION:\n{QUESTION}\n\n"
        f"REFERENCE SOLUTION:\n{SOLUTION}\n\n"
        f"RUBRIC:\n{RUBRIC}\n\n"
        f"{batch_schema}\n\n"
        f"STUDENT ANSWERS ({len(answer_texts)}):\n{answers_blob}\n\n"
        "Grade all answers and return JSON array only."
    )
    payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    }
    url = base_url.rstrip("/") + "/chat/completions"
    resp = post_json(url, payload, timeout=timeout)
    content = (
        resp.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    parsed = extract_json_payload(content)
    if isinstance(parsed, dict) and "grades" in parsed:
        parsed = parsed["grades"]
    if not isinstance(parsed, list):
        raise ValueError("Batch response is not a JSON array.")

    by_index = {}
    for raw in parsed:
        if not isinstance(raw, dict):
            continue
        idx = raw.get("index")
        if not isinstance(idx, int):
            continue
        by_index[idx] = normalize_grade(raw)

    results: list[dict] = []
    for i in range(len(answer_texts)):
        if i not in by_index:
            raise ValueError(f"Missing grade for batch index {i}")
        results.append(by_index[i])
    return results


def is_effectively_empty(answer: str) -> bool:
    if answer is None:
        return True
    cleaned = re.sub(r"\s+", " ", str(answer)).strip()
    return cleaned == ""


def main() -> int:
    args = parse_args()

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 1

    output_path = (
        Path(args.output).expanduser().resolve()
        if args.output
        else input_path.with_name(input_path.stem + "-graded.json")
    )

    with input_path.open("r", encoding="utf-8") as f:
        items = json.load(f)

    if not isinstance(items, list):
        print("Input JSON must be an array of objects.", file=sys.stderr)
        return 1

    try:
        model = args.model or pick_model(args.base_url, args.timeout)
    except error.URLError as e:
        print(
            "Could not connect to vLLM OpenAI endpoint at "
            f"{args.base_url}. Start vLLM first, then rerun.\n"
            f"Connection error: {e}",
            file=sys.stderr,
        )
        return 4
    print(f"Using model: {model}")

    total = len(items) if args.limit is None else min(len(items), args.limit)
    graded_items = [dict(item) for item in items]
    non_empty_idxs = []
    for i in range(total):
        if not is_effectively_empty(graded_items[i].get("studentResponse", "")):
            non_empty_idxs.append(i)

    if args.batch_size < 1:
        print("--batch-size must be >= 1", file=sys.stderr)
        return 1

    print(
        f"Grading {len(non_empty_idxs)} non-empty responses "
        f"in batches of {args.batch_size}..."
    )
    done = 0
    render_progress(done, len(non_empty_idxs), mode=args.progress_mode)
    num_batches = math.ceil(len(non_empty_idxs) / args.batch_size) if non_empty_idxs else 0

    for batch_i in range(num_batches):
        start = batch_i * args.batch_size
        end = min(start + args.batch_size, len(non_empty_idxs))
        batch_idxs = non_empty_idxs[start:end]
        answers = [graded_items[i]["studentResponse"] for i in batch_idxs]
        print(
            f"Running batch {batch_i + 1}/{num_batches} "
            f"({len(answers)} responses)...",
            flush=True,
        )

        try:
            if len(answers) == 1:
                grades = [
                    grade_one_answer(
                        answer_text=answers[0],
                        base_url=args.base_url,
                        model=model,
                        timeout=args.timeout,
                    )
                ]
            else:
                grades = grade_batch_answers(
                    answer_texts=answers,
                    base_url=args.base_url,
                    model=model,
                    timeout=args.timeout,
                )
            for local_i, grade in enumerate(grades):
                global_i = batch_idxs[local_i]
                graded_items[global_i]["llmGrading"] = grade
        except error.HTTPError as e:
            print(
                f"\nHTTP error for batch {batch_i + 1}/{num_batches}: "
                f"{e.code} {e.reason}",
                file=sys.stderr,
            )
            return 2
        except Exception as e:  # noqa: BLE001
            print(
                f"\nFailed grading batch {batch_i + 1}/{num_batches}: {e}",
                file=sys.stderr,
            )
            return 3

        done += len(batch_idxs)
        render_progress(done, len(non_empty_idxs), mode=args.progress_mode)

    with output_path.open("w", encoding="utf-8") as f:
        json.dump(graded_items, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Wrote graded output: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
