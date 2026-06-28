module.exports = {
  apps: [
    {
      name: 'apex-dev',
      script: 'node_modules/next/dist/bin/next',
      args: 'dev',
      interpreter: 'node',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      restart_delay: 2000,   // wait 2s before restart to avoid tight crash loops
      max_restarts: 20,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      error_file: '.pm2/err.log',
      out_file:   '.pm2/out.log',
      merge_logs:  true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
