module.exports = {
  apps: [
    {
      name: "aster",
      cwd: "/opt/aster_fork",
      script: "npm",
      args: "run dev",
      env: {
        NODE_ENV: "production",
      },
      // Reduce disk I/O from PM2 logs
      error_file: "/home/seed/.pm2/logs/aster-error.log",
      out_file: "/home/seed/.pm2/logs/aster-out.log",
      log_date_format: "",      // Skip timestamp overhead in PM2 logs
      combine_logs: true,
      merge_logs: true,
      autorestart: false,       // Disabled - bot running elsewhere
    },
    {
      name: "aster-notifier",
      cwd: "/opt/aster_fork",
      script: "node",
      args: "scripts/aster-notifier.cjs",
      env: {
        NODE_ENV: "production",
        ASTER_WS_URL: "ws://localhost:8081/ws", // adjust to your backend WS
        DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1434700977445015705/1nuDZWI5loiG7yZZ9LiKviHrHMHaldBEIlWElS09y--ZBoVP3nxEN-9_WgxoYN7_Pa9E",
        HEARTBEAT_HOURS: "0",
        LIFECYCLE_NOTIFS: "0"   // 👈 turn off boot/started/stopping messages
      },
      autorestart: true,
      exp_backoff_restart_delay: 2000,
      max_memory_restart: "200M",
      error_file: "/dev/null",
      out_file: "/dev/null",
      log_date_format: "",
    },
  ],
};
