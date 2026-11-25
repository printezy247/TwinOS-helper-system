# Railway functions host. Deploy with this directory as the build context:
#   railway up supabase/functions --path-as-root --service <service>
FROM denoland/deno:2.9.7
WORKDIR /app
COPY . .
ENV PORT=9000
# --unstable-sloppy-imports keeps the bare specifiers from import_map.json
# working without a separate install step.
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--unstable-sloppy-imports", "router.ts"]
