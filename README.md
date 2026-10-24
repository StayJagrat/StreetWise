# Streetwise · JP development

This branch starts from `main` commit `519db43` and adds the Supabase persistence foundation to the existing PWA. Development changes belong to **JP**. No automatic GitHub-to-Supabase deployment is connected.

While this change was being verified, Arya merged the engine/API work into `main` at `cec4172`. That independent update was reviewed and is covered in the workflow's integration handoff. It is not merged into this Supabase branch; the current JP verification applies to the original PWA plus the new persistence foundation.

- [Repository-based workflow](docs/WORKFLOW.md): current implementation, priorities, ownership, and completion gates.
- [Supabase setup and verification](docs/SUPABASE.md): schema, environment, local tests, and cloud setup.
- [Existing PWA guide](streetwise-web/README.md): screens, message contract, voice hooks, and map assets.

```bash
cd streetwise-web
npm ci
npm test
npm run relay
# In a second terminal:
npm run dev
```

Without Supabase environment variables, the relay uses in-memory demo storage. With the server-only credentials configured, it records demo walks and recovers history from Supabase. The relay accepts replay locations only. Real walks need the authenticated gateway described in the workflow.

The cloud development project is [streetwise-jp-dev](https://supabase.com/dashboard/project/myihzchlereyzckkavbn). Supabase's default database branch label `main` is independent of GitHub's `main` branch; this separate development project does not deploy or modify GitHub `main`.
