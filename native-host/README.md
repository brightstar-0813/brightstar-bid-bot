# Brightstar Bid bot — CSV auto-source (native messaging host)
#
# 1) Refresh CSV button — re-read pinned file / URL / ask to pick again
# 2) Pin local CSV (File System Access) — poll on a timer
# 3) Native watcher — OS file watch via native-host/ (Windows installer included)
# 4) HTTP(S) URL — poll a cron-published CSV URL
#
# Windows native host:
#   cd native-host
#   .\install-windows.ps1 -ExtensionId <chrome-extension-id> -CsvPath "D:\Work\JobHunting\Prompts\Bots\sf-job-capture\download\jobs_latest.csv"
#
# Then in the bot UI: enable Native watcher, Save source settings.

See install-windows.ps1 for registration details.
