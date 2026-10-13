import { serve } from "@hono/node-server"

import { app } from "./app"

const PORT = Number(process.env.PORT ?? 8088)

serve({ fetch: app.fetch, port: PORT }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`server-homepage listening on http://localhost:${info.port}`)
})
