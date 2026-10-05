cat << 'EOF' > start.sh
#!/data/data/com.termux/files/usr/bin/bash
export TELEGRAM_BOT_TOKEN="8401956459:AAGhCU9vdZGm0a1eU7hj8ZDlXNvwSkhuNs0"
export TELEGRAM_CHAT_ID="1168053894"
cd ~/macsaati-backend
node telegram_bot.js
EOF
