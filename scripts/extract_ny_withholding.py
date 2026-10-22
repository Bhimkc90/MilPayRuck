"""Maintainer tool: extract New York withholding tables from official NYS-50-T PDFs.

Usage (run from a directory that does NOT contain the downloaded PDFs):
    python3 -I scripts/extract_ny_withholding.py <nys50_t_nys.pdf> <nys50_t_nyc.pdf> <nys50_t_y.pdf> <out.json>

Requires the `pypdf` package (maintainer machine only; not a runtime dependency).
The PDFs are only parsed as text; nothing in them is executed.

The output is a candidate snapshot. It is NOT activated automatically: run
`npm run data:validate` and `npm test`, which check the parsed tables against the
worked examples printed in each publication, before committing it.
"""

import json
import re
import sys

from pypdf import PdfReader

PERIOD_BY_LETTER = {"A": "weekly", "B": "biweekly", "C": "semimonthly", "D": "monthly", "E": "daily"}
ALLOWANCE_ORDER = ["daily", "weekly", "biweekly", "semimonthly", "monthly", "annual"]
NUM = r"\$?[\d,]+(?:\.\d+)?"


def num(token):
    return float(token.replace("$", "").replace(",", ""))


def pdf_lines(path):
    reader = PdfReader(path)
    lines = []
    for page in reader.pages:
        lines.extend((page.extract_text() or "").splitlines())
    return [line.strip() for line in lines]


def header(lines):
    joined = " ".join(lines[:15])
    revision = re.search(r"\((\d{1,2}/\d{2})\)", joined)
    effective = re.search(r"Effective (\w+ \d{1,2}, \d{4}) . (\w+ \d{1,2}, \d{4})", joined)
    return {
        "revision": revision.group(1) if revision else None,
        "effectiveFrom": effective.group(1) if effective else None,
        "effectiveTo": effective.group(2) if effective else None,
    }


def allowances(lines):
    start = next(i for i, line in enumerate(lines) if line == "Table A")
    rows = []
    pattern = re.compile(r"(?:^|\s)(Single|Married) ((?:" + NUM + r"\s*){11})$")
    for line in lines[start:]:
        match = pattern.search(line)
        if match:
            values = [num(v) for v in match.group(2).split()]
            rows.append((match.group(1).lower(), values))
        if len(rows) == 12:
            break
    if len(rows) != 12:
        raise ValueError("Table A not found or incomplete")
    result = {}
    for index, (status, values) in enumerate(rows):
        period = ALLOWANCE_ORDER[index // 2]
        steps = {round(values[i + 1] - values[i], 2) for i in range(10)}
        if len(steps) != 1:
            raise ValueError(f"Non-linear exemption allowance for {period}/{status}: {steps}")
        result.setdefault(period, {})[status] = {"deduction": values[0], "perExemption": steps.pop()}
    return result


def exact_tables(lines):
    tables = {"single": {}, "married": {}}
    status = None
    i = 0
    row = re.compile(r"^(\d{1,2}) (" + NUM + r") (" + NUM + r") (" + NUM + r") (0\.\d{4}) (" + NUM + r")$")
    open_row = re.compile(r"^(\d{1,2}) (" + NUM + r") \.{3,} (" + NUM + r") (0\.\d{4}) (" + NUM + r")$")
    capped = re.compile(r"^(\d{1,2}) (" + NUM + r") & over")
    while i < len(lines):
        line = lines[i]
        if "Exact Calculation Method" in line and re.search(r"\bSingle\b", line):
            status = "single"
        elif "Exact Calculation Method" in line and re.search(r"\bMarried\b", line):
            status = "married"
        match = re.match(r"^Table II - ([A-E]) (\w+) [Pp]ayroll", line)
        if match and status:
            period = PERIOD_BY_LETTER[match.group(1)]
            brackets = []
            j = i + 1
            while j < len(lines):
                candidate = lines[j]
                full = row.match(candidate)
                open_ended = open_row.match(candidate)
                cap = capped.match(candidate)
                if full:
                    brackets.append({
                        "atLeast": num(full.group(2)),
                        "lessThan": num(full.group(3)),
                        "subtract": num(full.group(4)),
                        "rate": float(full.group(5)),
                        "add": num(full.group(6)),
                    })
                elif open_ended:
                    brackets.append({
                        "atLeast": num(open_ended.group(2)),
                        "lessThan": None,
                        "subtract": num(open_ended.group(3)),
                        "rate": float(open_ended.group(4)),
                        "add": num(open_ended.group(5)),
                    })
                    break
                elif cap:
                    brackets.append({"atLeast": num(cap.group(2)), "lessThan": None, "unsupported": "Method III"})
                    break
                elif brackets and candidate.startswith("Table II"):
                    break
                j += 1
            if period in tables[status]:
                raise ValueError(f"Duplicate table {status}/{period}")
            tables[status][period] = brackets
            i = j
        i += 1
    for status, periods in tables.items():
        missing = set(PERIOD_BY_LETTER.values()) - set(periods)
        if missing:
            raise ValueError(f"Missing {status} tables: {sorted(missing)}")
    return tables


def supplemental_rates(lines):
    text = " ".join(lines[:120])
    return [float(m) / 100 for m in re.findall(r"supplemental rate of ([\d.]+)%", text)] or [
        float(m) / 100 for m in re.findall(r"(?:resident|nonresident) \.+ ([\d.]+)%", text)
    ]


def extract(path, jurisdiction):
    lines = pdf_lines(path)
    return {
        "jurisdiction": jurisdiction,
        **header(lines),
        "allowances": allowances(lines),
        "exactCalculation": exact_tables(lines),
        "supplementalRatesFound": supplemental_rates(lines),
    }


def main():
    nys, nyc, yonkers, out = sys.argv[1:5]
    data = {
        "nys": extract(nys, "NYS"),
        "nyc": extract(nyc, "NYC"),
        "yonkersResident": extract(yonkers, "Yonkers resident"),
    }
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
