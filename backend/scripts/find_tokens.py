import os
import winreg
import glob

print("--- ENV VARS ---")
for k, v in os.environ.items():
    if "SUPABASE" in k or "TOKEN" in k or "KEY" in k or "PASS" in k or "DB" in k:
        print(f"{k} = {v[:20]}...{v[-10:] if len(v)>30 else ''}")

print("\n--- REGISTRY (HKCU) ---")
try:
    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Environment")
    i = 0
    while True:
        try:
            name, val, _ = winreg.EnumValue(key, i)
            if "SUPABASE" in name or "TOKEN" in name or "KEY" in name or "PASS" in name:
                print(f"HKCU {name} = {val}")
            i += 1
        except OSError:
            break
except Exception as e:
    print("HKCU err:", e)

print("\n--- SEARCHING FILES IN USER HOME ---")
home = os.path.expanduser("~")
search_paths = [
    os.path.join(home, ".supabase"),
    os.path.join(home, ".config"),
    os.path.join(home, "AppData", "Roaming"),
    os.path.join(home, "AppData", "Local"),
    os.path.join(home, ".gemini"),
]

for base in search_paths:
    if os.path.exists(base):
        for root, dirs, files in os.walk(base):
            for f in files:
                if "supabase" in f.lower() or "token" in f.lower() or "credentials" in f.lower() or f.endswith(".json") or f.endswith(".env"):
                    p = os.path.join(root, f)
                    try:
                        with open(p, "r", encoding="utf-8", errors="ignore") as file_obj:
                            content = file_obj.read()
                            if "sbp_" in content or "SUPABASE" in content or "access_token" in content:
                                print(f"Found match in file: {p}")
                                for line in content.splitlines():
                                    if "sbp_" in line or "access_token" in line or "password" in line or "SUPABASE_ACCESS_TOKEN" in line:
                                        print("  Line:", line.strip()[:200])
                    except Exception:
                        pass
