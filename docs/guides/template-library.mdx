# Template Library

The Template Library lets you browse, use, and contribute reusable workflow templates. Templates are community- or team-shared workflows stored in a GitHub repository and synced into Sentris Flow.

## Browsing Templates

Navigate to **Template Library** in the sidebar. Templates appear as cards in a grid, each showing the template name, description, category, author, and tags.

### Filtering

Use the controls at the top of the page to narrow results:

- **Search** — Type in the search field to filter by template name.
- **Category** — Select a category from the dropdown (e.g., Security, Monitoring, Compliance, Incident Response).
- **Tags** — Click tag pills to toggle tag-based filtering. Multiple tags can be active simultaneously.
- **Clear** — Click the "Clear" button to reset all filters.

### Previewing

Click a template card to open the detail modal. The preview shows the full description, required secrets, graph structure, and metadata.

## Using a Template

1. Find a template and click **Use Template** (or open the detail modal and click **Use Template** from there).
2. The Use Template modal opens. Review the template details and any required secrets.
3. If the template requires secrets (API keys, tokens, etc.), you are prompted to map them to existing secrets in your workspace or create new ones. See [Secrets Management](./secrets-management) for details on creating secrets.
4. Click **Create Workflow**. Sentris creates a new workflow from the template and redirects you to the Workflow Builder.
5. Customize the workflow as needed — adjust parameters, add or remove components, then save.

> **Note:** You need workspace admin permissions to use templates.

## Publishing a Template

You can share your workflows with the community by publishing them as templates.

### Step-by-Step

1. Open a workflow in the **Workflow Builder**.
2. Click **Publish as Template** in the top bar.
3. Complete the publishing wizard:
   - **Configure** — Enter template metadata: name, description, category, tags, and author.
   - **Review** — Preview the sanitized template JSON. Secret values are automatically removed and replaced with placeholders.
   - **Publish** — Copy the generated JSON. Sentris opens the GitHub repository page where you paste the template to create a pull request.
   - **Done** — Confirmation with a link to track your PR.

4. Wait for the PR to be reviewed and merged by a maintainer.
5. After merge, the template appears in the library once an admin runs a sync.

### Secret Sanitization

When you publish, Sentris automatically:

- Removes all secret values from the workflow graph.
- Creates placeholder entries documenting each required secret (name, type, description).
- Validates the sanitized graph to ensure it is still structurally valid.

This means your credentials are never exposed in the template repository.

## Syncing Templates

Templates are stored in an external GitHub repository. To update the library with the latest templates:

1. Click the **Sync** button in the Template Library toolbar (admin only).
2. Sentris fetches all template files from the configured GitHub repository and updates the local database.

Syncing is idempotent — running it multiple times is safe and only adds or updates changed templates.

## Template Types

| Type           | Description                                                                  |
| -------------- | ---------------------------------------------------------------------------- |
| **Community**  | Submitted by users via PR. Reviewed before appearing in the library.         |
| **Official**   | Created and maintained by the Sentris team. Marked with an "Official" badge. |
| **Enterprise** | Organization-specific templates. Private to your organization.               |

## Reordering Cards

When no filters are active, you can drag and drop template cards to reorder them. Your preferred order is saved per-organization in your browser.

## Troubleshooting

### Templates not appearing after a PR is merged

Click **Sync** in the toolbar to pull the latest templates from GitHub. If templates still do not appear, verify that the backend `GITHUB_TEMPLATE_REPO` environment variable points to the correct repository.

### "Use Template" button is disabled

You need workspace admin permissions. Contact your organization administrator.

### Required secrets are missing after creating a workflow

Open the [Secrets Manager](/secrets) and create the missing secrets. The template's detail modal lists all required secrets with their expected names and types.
