// pm2 process definition for the production API.
//
// Install:
//   cp deploy/pm2/ecosystem.config.js /var/www/html/tasks-beautybooth/
//   cd /var/www/html/tasks-beautybooth && pm2 start ecosystem.config.js && pm2 save
//
// Reload after a new build:
//   cd /var/www/html/tasks-beautybooth && git pull && pm2 restart bbtasks-api

module.exports = {
    apps: [
        {
            name: "bbtasks-api",
            cwd: "/var/www/html/tasks-beautybooth/server",
            script: "dist/server.js",

            // SINGLE instance, fork mode - deliberate, not a default.
            // Rate-limit counters, the Prometheus metrics registry and the SSE
            // connection registry are all in-process. A second instance would
            // silently double every rate limit and leave half the connected
            // clients missing live updates.
            instances: 1,
            exec_mode: "fork",

            env: {
                NODE_ENV: "prod",
                // Must be set HERE, not in .env: Node reads TZ at startup,
                // before dotenv runs. This is what makes "due today" mean today
                // in Dhaka rather than today in UTC. The DB side is handled
                // separately by DB_TIMEZONE - both are required.
                TZ: "Asia/Dhaka",
            },

            // This box already runs five other production apps near its RAM
            // limit. A leak here restarts us instead of letting the kernel's
            // OOM killer choose a victim among them.
            max_memory_restart: "400M",

            error_file: "/var/log/bbtasks/error.log",
            out_file: "/var/log/bbtasks/out.log",
            merge_logs: true,
            time: true,
        },
    ],
};
