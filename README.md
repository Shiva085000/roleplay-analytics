# Roleplay Analytics

Front end for the IIFL Sarvam roleplay analytics dashboard: completion rate,
why sessions fail, before/after comparisons, and the per-session Excel for any
hour, day, week or month.

Upload a log export, pick a period, read the analysis and download the Excel.

This page holds no data. It reads everything from the analytics backend
(`server.py` in the private `roleplay-analysis` project) running on the same
computer at `http://localhost:8765`; change the address under **Settings**.
When Chrome asks whether this site may access devices on your local network,
choose **Allow** — that is how the page reaches the local backend.
