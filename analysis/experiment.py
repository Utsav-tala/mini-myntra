"""Turns one experiment's raw k6 output into results, and compares experiments.

    python analysis/experiment.py process <raw-dir> <out-dir> <label>
    python analysis/experiment.py compare <out-dir> [<out-dir> ...] --out <dir>

process  reads <raw-dir> (what loadtest/run.sh wrote: meta.txt, summary.json,
         k6.csv.gz), pulls CloudWatch for the run's time window with the AWS
         CLI (run it before teardown, while the load balancer exists), and
         writes to <out-dir>:
           minutes.csv     per minute: users, client and server latency, CPU,
                           instances, requests, errors
           steps.csv       (step-shaped runs only) per user level, with the
                           suggested PEAK_VUS
           results.json    headline numbers used by `compare`
           timeline.png    instances, CPU and p95 over the run
           meta.txt, k6-summary.json   copied from the raw run
compare  writes comparison.md, comparison.csv and p95-by-experiment.png.

Times are stored in UTC and shown in IST (UTC+5:30) in graphs.
"""

import argparse
import csv
import gzip
import json
import shutil
import subprocess
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import mean

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402

REGION = "ap-south-1"
ASG = "mini-myntra-asg"
IST = timezone(timedelta(hours=5, minutes=30))

# On-demand prices in ap-south-1 (USD per hour), from AWS price lists.
PRICE = {
    "t3_micro": 0.0112,
    "alb": 0.0239,
    "redis_t4g_micro": 0.020,
    "public_ipv4": 0.005,
    "detailed_monitoring": 7 * 0.30 / 730,  # 7 metrics per instance
    "ebs_8gb_gp3": 8 * 0.0912 / 730,
}

# Reference palette (light mode), as in plot_scaling_check.py.
SURFACE, INK, INK_2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
BLUE, ORANGE, REFERENCE = "#2a78d6", "#eb6834", "#8a8984"


# ---------- reading raw k6 output ----------

def read_meta(raw):
    meta = {}
    for line in (raw / "meta.txt").read_text().splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            meta[k.strip()] = v.strip()
    return meta


def utc(stamp):
    return datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)


def pct(values, p):
    s = sorted(values)
    return s[min(len(s) - 1, int(len(s) * p))] if s else None


def k6_minutes(raw):
    """Per-minute client-side numbers from k6.csv.gz, plus per-second data
    (users, latencies, failures) for the step analysis."""
    dur, failed, vus = defaultdict(list), defaultdict(int), defaultdict(int)
    sec_dur, sec_failed, sec_vus = defaultdict(list), defaultdict(int), {}
    by_instance = defaultdict(int)
    with gzip.open(raw / "k6.csv.gz", "rt", newline="") as f:
        for row in csv.DictReader(f):
            name = row["metric_name"]
            sec = int(row["timestamp"])
            minute = sec // 60 * 60
            if name == "http_req_duration":
                v = float(row["metric_value"])
                dur[minute].append(v)
                sec_dur[sec].append(v)
            elif name == "http_req_failed" and row["metric_value"].startswith("1"):
                failed[minute] += 1
                sec_failed[sec] += 1
            elif name == "vus":
                n = int(float(row["metric_value"]))
                vus[minute] = max(vus[minute], n)
                sec_vus[sec] = n
            elif name == "requests_by_instance":
                by_instance[row["extra_tags"].replace("instance=", "")] += 1
    seconds = {"vus": sec_vus, "dur": sec_dur, "failed": sec_failed}
    out = {}
    for m in sorted(dur):
        a = dur[m]
        out[m] = {
            "vus": vus.get(m, 0),
            "client_requests": len(a),
            "client_rps": round(len(a) / 60, 1),
            "client_p50_ms": round(pct(a, 0.50), 1),
            "client_p95_ms": round(pct(a, 0.95), 1),
            "client_p99_ms": round(pct(a, 0.99), 1),
            "failed": failed.get(m, 0),
        }
    return out, dict(by_instance), seconds


# ---------- CloudWatch ----------

def aws(*args):
    result = subprocess.run(["aws", "--region", REGION, *args, "--output", "json"],
                            check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def load_balancer_dimensions():
    """CloudWatch names of the live load balancer and target group."""
    alb_arn = aws("elbv2", "describe-load-balancers", "--names", "mini-myntra-alb")["LoadBalancers"][0]["LoadBalancerArn"]
    tg_arn = aws("elbv2", "describe-target-groups", "--names", "mini-myntra-app")["TargetGroups"][0]["TargetGroupArn"]
    return alb_arn.split(":loadbalancer/")[1], tg_arn.split(":")[-1]


def cloudwatch_minutes(start, end):
    alb, tg = load_balancer_dimensions()

    def q(qid, ns, metric, dims, stat):
        return {"Id": qid, "MetricStat": {"Metric": {"Namespace": ns, "MetricName": metric,
                "Dimensions": [{"Name": k, "Value": v} for k, v in dims]}, "Period": 60, "Stat": stat}}

    queries = [
        q("cpu", "AWS/EC2", "CPUUtilization", [("AutoScalingGroupName", ASG)], "Average"),
        q("instances", "AWS/AutoScaling", "GroupInServiceInstances", [("AutoScalingGroupName", ASG)], "Maximum"),
        q("desired", "AWS/AutoScaling", "GroupDesiredCapacity", [("AutoScalingGroupName", ASG)], "Maximum"),
        q("requests", "AWS/ApplicationELB", "RequestCount", [("LoadBalancer", alb)], "Sum"),
        q("p95", "AWS/ApplicationELB", "TargetResponseTime", [("LoadBalancer", alb)], "p95"),
        q("avg", "AWS/ApplicationELB", "TargetResponseTime", [("LoadBalancer", alb)], "Average"),
        q("healthy", "AWS/ApplicationELB", "HealthyHostCount", [("TargetGroup", tg), ("LoadBalancer", alb)], "Minimum"),
        q("elb5xx", "AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", [("LoadBalancer", alb)], "Sum"),
        q("app5xx", "AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", [("LoadBalancer", alb)], "Sum"),
    ]
    data = aws("cloudwatch", "get-metric-data", "--metric-data-queries", json.dumps(queries),
               "--start-time", start.strftime("%Y-%m-%dT%H:%M:%SZ"),
               "--end-time", end.strftime("%Y-%m-%dT%H:%M:%SZ"), "--scan-by", "TimestampAscending")
    out = defaultdict(dict)
    for r in data["MetricDataResults"]:
        for ts, v in zip(r["Timestamps"], r["Values"]):
            minute = int(datetime.fromisoformat(ts).timestamp()) // 60 * 60
            if r["Id"] in ("p95", "avg"):
                v = round(v * 1000, 1)
            elif r["Id"] == "cpu":
                v = round(v, 1)
            else:
                v = int(v)
            out[minute][{"p95": "server_p95_ms", "avg": "server_avg_ms", "cpu": "cpu_pct",
                         "requests": "server_requests"}.get(r["Id"], r["Id"])] = v
    return out


# ---------- process ----------

COLUMNS = ["utc_minute", "ist_minute", "vus", "client_rps", "client_p50_ms", "client_p95_ms",
           "client_p99_ms", "failed", "cpu_pct", "instances", "desired", "healthy",
           "server_requests", "server_p95_ms", "server_avg_ms", "elb5xx", "app5xx"]


def cost_per_hour(instances):
    per_instance = (PRICE["t3_micro"] + PRICE["public_ipv4"] + PRICE["detailed_monitoring"]
                    + PRICE["ebs_8gb_gp3"])
    shared = PRICE["alb"] + 2 * PRICE["public_ipv4"] + PRICE["redis_t4g_micro"]
    return instances * per_instance + shared


def steps_table(seconds, server, step_vus):
    """Per user level for step-shaped runs (E1), and the suggested peak.

    Uses only the seconds where the user count sits exactly on a step, so
    ramps between steps do not blur the levels. A level counts as healthy
    while throughput still grows with users (requests per user at least 85%
    of the lightest level's) and errors stay under 1%; past that point extra
    users only queue.
    """
    levels = defaultdict(list)
    for sec, n in seconds["vus"].items():
        if n and n % step_vus == 0:
            levels[n].append(sec)
    table, base_eff, last_good = [], None, None
    for vus in sorted(levels):
        secs = sorted(levels[vus])[5:]  # skip the first seconds of each step
        durs = [d for s in secs for d in seconds["dur"].get(s, [])]
        if not secs or not durs:
            continue
        rps = len(durs) / len(secs)
        err = 100 * sum(seconds["failed"].get(s, 0) for s in secs) / len(durs)
        minutes = {s // 60 * 60 for s in secs}
        full = [server[m] for m in minutes if m in server
                and all(seconds["vus"].get(m + i) == vus for i in range(0, 60, 10))]
        cpu = [m["cpu_pct"] for m in full if "cpu_pct" in m]
        sp95 = [m["server_p95_ms"] for m in full if "server_p95_ms" in m]
        eff = rps / vus
        base_eff = base_eff or eff
        ok = eff >= 0.85 * base_eff and err < 1
        if ok and (last_good is None or table[-1]["healthy"]):
            last_good = vus
        table.append({"vus": vus, "client_rps": round(rps, 1), "client_p95_ms": round(pct(durs, 0.95), 1),
                      "server_p95_ms": round(mean(sp95), 1) if sp95 else "",
                      "cpu_pct": round(mean(cpu), 1) if cpu else "",
                      "error_pct": round(err, 3), "healthy": ok})
    suggested = int(round(last_good * 1.5 / 50) * 50) if last_good else None
    return table, last_good, suggested


def style(ax):
    ax.set_facecolor(SURFACE)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=INK_2, labelsize=9)


def num(v):
    return None if v in (None, "") else float(v)


def plot_timeline(rows, peak, label, title, out, killed_at=None):
    t = [datetime.fromisoformat(r["ist_minute"]) for r in rows]
    fig, axes = plt.subplots(3, 1, figsize=(10, 8.2), sharex=True,
                             gridspec_kw={"height_ratios": [1, 1, 1.5]})
    fig.patch.set_facecolor(SURFACE)
    for ax in axes:
        style(ax)
        if peak:
            ax.axvspan(datetime.fromisoformat(peak[0]["ist_minute"]),
                       datetime.fromisoformat(peak[-1]["ist_minute"]) + timedelta(minutes=1),
                       color=GRID, alpha=0.5, linewidth=0)
    axes[0].step(t, [num(r.get("instances")) for r in rows], where="post", color=BLUE, linewidth=2)
    axes[0].set_ylim(0, 4.6)
    axes[0].set_yticks([0, 1, 2, 3, 4])
    axes[0].set_ylabel("Instances\nin service", color=INK_2, fontsize=9)
    if peak:
        axes[0].text(datetime.fromisoformat(peak[0]["ist_minute"]), 4.25, " Peak load",
                     color=INK_2, fontsize=9, va="center")
    axes[1].plot(t, [num(r.get("cpu_pct")) for r in rows], color=BLUE, linewidth=2)
    axes[1].axhline(50, color=REFERENCE, linewidth=1, linestyle="--")
    axes[1].text(t[-1], 53, "Scaling target 50% ", color=INK_2, fontsize=9, ha="right", va="bottom")
    axes[1].set_ylim(0, 100)
    axes[1].set_ylabel("Average CPU\n(%)", color=INK_2, fontsize=9)
    axes[2].plot(t, [num(r.get("client_p95_ms")) for r in rows], color=ORANGE, linewidth=2,
                 label="Client side (k6)")
    axes[2].plot(t, [num(r.get("server_p95_ms")) for r in rows], color=BLUE, linewidth=2,
                 label="Server side (load balancer)")
    axes[2].set_ylim(bottom=0)
    axes[2].set_ylabel("p95 response time\n(ms)", color=INK_2, fontsize=9)
    leg = axes[2].legend(loc="best", frameon=False, fontsize=9)
    for txt in leg.get_texts():
        txt.set_color(INK)
    if killed_at:
        # E6: when one instance was terminated by hand.
        for ax in axes:
            ax.axvline(killed_at, color=INK, linewidth=1, linestyle=":")
        axes[0].text(killed_at, 0.4, f" server killed {killed_at:%H:%M:%S}", color=INK, fontsize=9)
    axes[2].xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
    axes[2].set_xlabel(f"Time (IST), {t[0]:%d %b %Y}", color=INK_2, fontsize=9)
    fig.suptitle(title, x=0.07, y=0.985, ha="left", fontsize=13, color=INK, fontweight="bold")
    fig.text(0.07, 0.945, label, ha="left", fontsize=10, color=INK_2)
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    fig.savefig(out, dpi=150, facecolor=SURFACE)
    plt.close(fig)


def process(raw, out, label):
    out.mkdir(parents=True, exist_ok=True)
    meta = read_meta(raw)
    start, end = utc(meta["started_utc"]), utc(meta["finished_utc"])
    shutil.copy(raw / "meta.txt", out / "meta.txt")
    shutil.copy(raw / "summary.json", out / "k6-summary.json")

    client, by_instance, seconds = k6_minutes(raw)
    server = cloudwatch_minutes(start - timedelta(minutes=2), end + timedelta(minutes=3))

    rows = []
    for m in sorted(set(client) | set(server)):
        r = {"utc_minute": datetime.fromtimestamp(m, timezone.utc).strftime("%Y-%m-%dT%H:%M"),
             "ist_minute": datetime.fromtimestamp(m, IST).strftime("%Y-%m-%dT%H:%M")}
        r.update(client.get(m, {}))
        r.update(server.get(m, {}))
        rows.append(r)
    with open(out / "minutes.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in COLUMNS})

    loaded = [r for r in rows if r.get("vus")]
    max_vus = max(r["vus"] for r in loaded)
    # Peak = full minutes at (or within 10% of) the highest user count.
    peak = [r for r in loaded if r["vus"] >= 0.9 * max_vus][1:-1] or [r for r in loaded if r["vus"] == max_vus]

    def avg(rs, key):
        vals = [num(r.get(key)) for r in rs if num(r.get(key)) is not None]
        return round(mean(vals), 1) if vals else None

    summary = json.loads((raw / "summary.json").read_text())["metrics"]
    total = summary["http_reqs"]["count"]
    failed = round(summary["http_req_failed"].get("value", summary["http_req_failed"].get("rate", 0)) * total)
    run_minutes = [r for r in rows if r.get("client_requests")]
    instance_minutes = sum(num(r.get("instances")) or 0 for r in run_minutes)
    run_cost = sum(cost_per_hour(num(r.get("instances")) or 1) / 60 for r in run_minutes)
    peak_instances = avg(peak, "instances")

    results = {
        "label": label,
        "profile": meta.get("profile"),
        "started_utc": start.isoformat(),
        "finished_utc": end.isoformat(),
        "total_requests": total,
        "failed_requests": failed,
        "failed_pct": round(100 * failed / total, 4) if total else 0,
        "client_p95_ms_overall": round(summary["http_req_duration"]["p(95)"], 1),
        "max_vus": max_vus,
        "peak_minutes": len(peak),
        "peak_rps": avg(peak, "client_rps"),
        "peak_client_p95_ms": avg(peak, "client_p95_ms"),
        "peak_server_p95_ms": avg(peak, "server_p95_ms"),
        "peak_server_avg_ms": avg(peak, "server_avg_ms"),
        "peak_cpu_pct": avg(peak, "cpu_pct"),
        "peak_instances": peak_instances,
        "max_instances": max((num(r.get("instances")) or 0 for r in rows), default=None),
        "instance_minutes": round(instance_minutes, 1),
        "est_cost_usd_run": round(run_cost, 4),
        "est_cost_usd_per_hour_at_peak": round(cost_per_hour(peak_instances or 1), 4),
        "est_cost_usd_per_million_requests": round(run_cost / total * 1e6, 3) if total else None,
        "requests_by_instance": by_instance,
    }

    if meta.get("SHAPE") == "step":
        table, last_good, suggested = steps_table(seconds, server, int(meta.get("STEP_VUS", 50)))
        with open(out / "steps.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(table[0]))
            w.writeheader()
            w.writerows(table)
        results["last_healthy_vus"] = last_good
        results["suggested_peak_vus"] = suggested
        for row in table:
            print("  {vus:>4} users  {client_rps:>7} req/s  client p95 {client_p95_ms:>7} ms  "
                  "server p95 {server_p95_ms} ms  CPU {cpu_pct}%  errors {error_pct}%  "
                  "{h}".format(h="ok" if row["healthy"] else "STRAINED", **row))
        print(f"Last healthy level: {last_good} users. Suggested PEAK_VUS for E2/E3/E5/E6: {suggested}")

    (out / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    render(out)
    print(f"{label}: {total:,} requests, {failed} failed, peak {results['peak_rps']} req/s, "
          f"server p95 {results['peak_server_p95_ms']} ms, client p95 {results['peak_client_p95_ms']} ms, "
          f"up to {results['max_instances']} instances, est. ${results['est_cost_usd_run']} for the run")


def peak_minutes(rows):
    """Full minutes at (or within 10% of) the highest user count."""
    loaded = [r for r in rows if num(r.get("vus"))]
    if not loaded:
        return []
    top = max(num(r["vus"]) for r in loaded)
    return [r for r in loaded if num(r["vus"]) >= 0.9 * top][1:-1] or [r for r in loaded if num(r["vus"]) == top]


def render(out):
    """Draws timeline.png from the saved minutes.csv and results.json, so a
    graph can be redrawn after teardown. Also records server p95 at the
    start and end of the peak, which shows what scaling changed."""
    with open(out / "minutes.csv", newline="") as f:
        rows = list(csv.DictReader(f))
    results = json.loads((out / "results.json").read_text())
    peak = peak_minutes(rows)
    p95 = [num(r.get("server_p95_ms")) for r in peak if num(r.get("server_p95_ms")) is not None]
    if len(p95) >= 4:
        results["peak_server_p95_first_ms"] = round(mean(p95[:2]), 1)
        results["peak_server_p95_last_ms"] = round(mean(p95[-2:]), 1)
        (out / "results.json").write_text(json.dumps(results, indent=2) + "\n")

    killed_at = None
    if (out / "termination.txt").exists():
        for line in (out / "termination.txt").read_text().splitlines():
            if line.startswith("terminated_utc="):
                killed_at = datetime.fromisoformat(line.split("=", 1)[1].replace("Z", "+00:00")).astimezone(IST).replace(tzinfo=None)

    label, most = results["label"], results.get("max_instances") or 0
    servers = f"{most:.0f} server{'s' if most != 1 else ''}"
    if "peak_server_p95_first_ms" in results:
        title = (f"{label}: p95 {results['peak_server_p95_first_ms']:.0f} ms → "
                 f"{results['peak_server_p95_last_ms']:.0f} ms through the peak, up to {servers}")
    else:
        title = label
    if killed_at:
        # First minute after the crash with low latency again.
        after = [r for r in rows if datetime.fromisoformat(r["ist_minute"]) > killed_at
                 and num(r.get("server_p95_ms")) is not None and num(r["server_p95_ms"]) < 100]
        if after:
            title = (f"{label}: back to p95 {num(after[0]['server_p95_ms']):.0f} ms by "
                     f"{after[0]['ist_minute'][11:]}, {results['failed_requests']:,} requests failed")
    if results.get("last_healthy_vus"):
        top_rps = max((num(r.get("client_rps")) or 0) for r in rows)
        title = (f"{label}: healthy up to {results['last_healthy_vus']} users, "
                 f"then saturates near {top_rps:.0f} req/s")
    subtitle = (f"{results.get('profile')} · peak {results['max_vus']} users · "
                f"{results['failed_requests']:,} failed of {results['total_requests']:,} requests · "
                "server-side p95 at the load balancer")
    plot_timeline(rows, peak, subtitle, title, out / "timeline.png", killed_at)


# ---------- compare ----------

def compare(dirs, out):
    out.mkdir(parents=True, exist_ok=True)
    rows = [json.loads((d / "results.json").read_text()) for d in dirs]
    cols = [("label", "Experiment"), ("max_vus", "Peak users"), ("peak_rps", "Peak req/s"),
            ("max_instances", "Max instances"), ("peak_server_p95_ms", "Server p95 at peak (ms)"),
            ("peak_client_p95_ms", "Client p95 at peak (ms)"), ("failed_requests", "Failed"),
            ("failed_pct", "Failed %"), ("instance_minutes", "Instance-minutes"),
            ("est_cost_usd_per_hour_at_peak", "Est. $/hour at peak"),
            ("est_cost_usd_per_million_requests", "Est. $ per million requests")]
    with open(out / "comparison.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow([c[1] for c in cols])
        for r in rows:
            w.writerow([r.get(c[0], "") for c in cols])
    lines = ["| " + " | ".join(c[1] for c in cols) + " |", "|" + " --- |" * len(cols)]
    for r in rows:
        lines.append("| " + " | ".join("" if r.get(c[0]) is None else str(r.get(c[0])) for c in cols) + " |")
    md = ("# Experiment comparison\n\nCosts are estimates from on-demand ap-south-1 prices "
          "(t3.micro, ALB, Redis, public IPv4, monitoring, EBS); load balancer capacity units "
          "and CPU-credit surcharges are not included.\n\n" + "\n".join(lines) + "\n")
    (out / "comparison.md").write_text(md)
    print(md)

    # Horizontal bars so the experiment names stay readable; top to bottom
    # in the order given on the command line.
    fig, ax = plt.subplots(figsize=(9, 0.6 * len(rows) + 1.6))
    fig.patch.set_facecolor(SURFACE)
    style(ax)
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    labels = [r["label"] for r in rows][::-1]
    vals = [r.get("peak_server_p95_ms") or 0 for r in rows][::-1]
    ax.barh(labels, vals, color=BLUE, height=0.55)
    for i, v in enumerate(vals):
        ax.text(v + max(vals) * 0.01, i, f"{v:.0f} ms", va="center", color=INK, fontsize=10)
    ax.set_xlabel("Server p95 at peak load (ms, mean of peak minutes)", color=INK_2, fontsize=9)
    ax.set_xlim(0, max(vals) * 1.15 if any(vals) else 1)
    fig.suptitle("Server p95 response time at peak load, by experiment",
                 x=0.02, y=0.98, ha="left", fontsize=12, color=INK, fontweight="bold")
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    fig.savefig(out / "p95-by-experiment.png", dpi=150, facecolor=SURFACE)
    plt.close(fig)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("process")
    a.add_argument("raw", type=Path)
    a.add_argument("out", type=Path)
    a.add_argument("label")
    b = sub.add_parser("compare")
    b.add_argument("dirs", type=Path, nargs="+")
    b.add_argument("--out", type=Path, required=True)
    c = sub.add_parser("plot", help="redraw timeline.png from saved results (no AWS needed)")
    c.add_argument("dirs", type=Path, nargs="+")
    args = p.parse_args()
    if args.cmd == "process":
        process(args.raw, args.out, args.label)
    elif args.cmd == "plot":
        for d in args.dirs:
            render(d)
    else:
        compare(args.dirs, args.out)


if __name__ == "__main__":
    main()
