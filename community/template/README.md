# Community Templates

Contribute reusable Sentris Flow workflows via pull request. After merge to `main`, templates appear in the app’s **Template Library → Community** tab.

## How to add a template

1. Create a folder under `community/template/<your-template-id>/`.
2. Add `template.json` using the same shape as official seed templates (`_metadata`, `graph`, `requiredSecrets`).
3. Optionally add a short `README.md` describing the workflow and any secrets/tools it needs.
4. Register the entry in [`index.json`](./index.json) (keep `version: 1`).
5. Open a PR against `main`. Maintainers review before merge.

### `index.json` entry (summary)

| Field                                        | Required | Notes                                     |
| -------------------------------------------- | -------- | ----------------------------------------- |
| `id`                                         | yes      | Stable slug, unique in the catalog        |
| `name` / `description`                       | yes      | Shown on Community cards                  |
| `author.displayName`                         | yes      | Contributor shoutout                      |
| `author.githubLogin` / `avatarUrl` / `title` | no       | Avatar + byline                           |
| `bannerUrl`                                  | no       | Optional card banner                      |
| `stats`                                      | no       | `nodeCount`, `setupLevel`                 |
| `templatePath`                               | yes      | Repo-relative path to `template.json`     |
| `htmlUrl`                                    | yes      | GitHub tree/blob URL for “View on GitHub” |
| `reviewed`                                   | no       | Set by maintainers after review           |

### Trust model

- The app only reads the catalog and template files from `main` after PR merge.
- Import into an org re-fetches the published `template.json` on the server (the browser never supplies the graph).
- Import does **not** auto-run the workflow or bind secrets.

### Catalog URL

After merge to `main`, the Community tab loads:

```
https://raw.githubusercontent.com/zebbern/Sentris/main/community/template/index.json
```

Override in local frontend only if needed via `VITE_COMMUNITY_TEMPLATES_INDEX_URL`.
