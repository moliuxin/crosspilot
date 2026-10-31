# -*- coding: utf-8 -*-
# webm 录屏 → mp4 parts（编码参数与主管线一致）+ d7 替换
import os, subprocess, sys, glob, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
REC = r"C:\Users\auro\.zcode\workspace\default\video_work\rec"
WORK = r"C:\Users\auro\Desktop\ZCode\video_work"
PARTS = os.path.join(WORK, "parts")
PARTS30 = os.path.join(WORK, "parts30")
ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
       "-r", "30", "-an", "-video_track_timescale", "15360"]
VF = "scale=1920:1080,setsar=1,format=yuv420p"

def run(args, tag):
    r = subprocess.run([FF] + args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print("FAILED", tag, r.stderr[-800:]); raise RuntimeError(tag)
    print("ok", tag, flush=True)

def probe_dur(p):
    r = subprocess.run([FF, "-hide_banner", "-i", p], capture_output=True, text=True, encoding="utf-8", errors="replace")
    for line in r.stderr.splitlines():
        if "Duration" in line:
            t = line.split("Duration:")[1].strip().split(",")[0]
            h, m, s = t.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    return 0.0

# 按 mtime 映射：第一批8个(旧)中6个有效 + 补录2个(新)
files = sorted(glob.glob(os.path.join(REC, "*.webm")), key=os.path.getmtime)
print("webm count:", len(files))
# 已知映射（第一轮输出日志确认）
KNOWN = {
    "aa5943df": "bi", "5f4d8d35": "c1", "0e384d6c": "c2", "31bbf288": "c5",
    "aae1691d": "c6", "03f258d6": "c8",
}
byhash = {os.path.basename(f).split("@")[1][:8]: f for f in files}
mapped = {}
for h, name in KNOWN.items():
    if h in byhash:
        mapped[name] = byhash[h]
# 剩下两个新的 = c3, c4（按时间序：先 c3 后 c4）
rest = [f for f in files if os.path.basename(f).split("@")[1][:8] not in KNOWN]
rest.sort(key=os.path.getmtime)
if len(rest) >= 2:
    mapped["c3"] = rest[-2]
    mapped["c4"] = rest[-1]
print("mapped:", {k: os.path.basename(v)[:20] for k, v in mapped.items()})

# 转码（30s 版各段裁 3.0s；bi 全长保留）
for name, src in mapped.items():
    dur = probe_dur(src)
    out30 = os.path.join(WORK, "rec_%s.mp4" % name)
    t = min(3.0, dur) if name != "bi" else dur
    run(["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-t", "%.3f" % t,
         "-vf", VF, "-r", "30"] + ENC + [out30], name)
    print("  %s -> %s (%.2fs)" % (name, out30, t))

# d7（3'41" 版 BI 段）：bi.mp4 取 0.5-11.0s 共 10.5s
bi = os.path.join(WORK, "rec_bi.mp4")
d7 = os.path.join(PARTS, "d7.mp4")
run(["-hide_banner", "-loglevel", "error", "-y", "-ss", "0.5", "-i", bi, "-t", "10.5",
     "-vf", VF, "-r", "30"] + ENC + [d7], "d7 replace")
# 30s 版 c7：bi 前 3.0s
c7 = os.path.join(PARTS30, "c7.mp4")
run(["-hide_banner", "-loglevel", "error", "-y", "-i", bi, "-t", "3.0",
     "-vf", VF, "-r", "30"] + ENC + [c7], "c7 replace")
print("DONE")
