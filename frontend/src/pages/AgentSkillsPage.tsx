import { useMemo, useRef, useState } from 'react';
import { FolderInput, Trash2, Upload } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import {
  useAgentSkills,
  useDeleteAgentSkill,
  useDiscoverAgentSkills,
  useImportAgentSkillZip,
  useImportDiscoveredAgentSkills,
  type DiscoveredAgentSkill,
} from '@/hooks/queries/useAgentSkillQueries';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { cn } from '@/lib/utils';

const DISCOVERY_DIR_LABEL =
  '.agents/skills, .claude/skills, .github/skills, .codex/skills, .kimi/skills, .opencode/skills';

function discoveryKey(item: DiscoveredAgentSkill): string {
  return `${item.sourceRoot}:${item.slug}`;
}

export function AgentSkillsPage() {
  useDocumentTitle('Agent Skills');
  const roles = useAuthStore((state) => state.roles);
  const canManage = hasAdminRole(roles);
  const { data: skills = [], isLoading, error } = useAgentSkills();
  const {
    data: discovered = [],
    isLoading: isDiscovering,
    error: discoverError,
    refetch: refetchDiscovered,
  } = useDiscoverAgentSkills();
  const deleteMutation = useDeleteAgentSkill();
  const importDiscoveredMutation = useImportDiscoveredAgentSkills();
  const importZipMutation = useImportAgentSkillZip();
  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const zipInputRef = useRef<HTMLInputElement>(null);

  const [selectedDiscoveryKeys, setSelectedDiscoveryKeys] = useState<Set<string>>(new Set());
  const [overwriteOnImport, setOverwriteOnImport] = useState(false);

  const notImported = useMemo(() => discovered.filter((item) => !item.imported), [discovered]);

  const handleDelete = async (id: string, name: string) => {
    if (!canManage) return;
    const ok = await confirm({
      title: 'Delete agent skill',
      description: `Remove "${name}" from your organization library?`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast({ title: 'Skill deleted' });
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const toggleDiscovery = (item: DiscoveredAgentSkill) => {
    const key = discoveryKey(item);
    setSelectedDiscoveryKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const importDiscovered = async (items: DiscoveredAgentSkill[]) => {
    if (!canManage || items.length === 0) return;
    try {
      const result = await importDiscoveredMutation.mutateAsync({
        items: items.map((item) => ({ slug: item.slug, sourceRoot: item.sourceRoot })),
        overwrite: overwriteOnImport,
      });
      toast({
        title: `Imported ${result.imported.length} skill(s)`,
        description:
          result.skipped.length > 0
            ? `${result.skipped.length} skipped (${result.skipped.map((s) => s.slug).join(', ')})`
            : undefined,
      });
      setSelectedDiscoveryKeys(new Set());
    } catch (err) {
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleImportSelected = () => {
    const items = discovered.filter((item) => selectedDiscoveryKeys.has(discoveryKey(item)));
    void importDiscovered(items);
  };

  const handleImportAllNew = () => {
    void importDiscovered(notImported);
  };

  const handleZipImport = async (file: File | undefined) => {
    if (!file || !canManage) return;
    try {
      const result = await importZipMutation.mutateAsync({ file, overwrite: overwriteOnImport });
      toast({
        title: `Imported ${result.imported.length} skill(s) from zip`,
        description: result.skipped.length > 0 ? `${result.skipped.length} skipped` : undefined,
      });
    } catch (err) {
      toast({
        title: 'Zip import failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      if (zipInputRef.current) zipInputRef.current.value = '';
    }
  };

  return (
    <div className="container max-w-5xl py-6 space-y-6">
      <p className="text-sm text-muted-foreground">
        Discovered from {DISCOVERY_DIR_LABEL}. Import folders into your org library for use on agent
        workflow nodes.
      </p>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FolderInput className="h-4 w-4" />
              Workspace skills
            </CardTitle>
            <CardDescription>Folders on disk under {DISCOVERY_DIR_LABEL}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={zipInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(event) => void handleZipImport(event.target.files?.[0])}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => zipInputRef.current?.click()}
                  disabled={importZipMutation.isPending}
                >
                  <Upload className="h-3.5 w-3.5 mr-1" />
                  Import zip
                </Button>
                <Button size="sm" variant="outline" onClick={() => void refetchDiscovered()}>
                  Refresh
                </Button>
                <div className="flex items-center gap-2 ml-auto">
                  <Checkbox
                    id="overwrite-import"
                    checked={overwriteOnImport}
                    onCheckedChange={(checked) => setOverwriteOnImport(Boolean(checked))}
                  />
                  <Label htmlFor="overwrite-import" className="text-xs">
                    Overwrite existing
                  </Label>
                </div>
              </div>
            ) : null}

            {isDiscovering ? <p className="text-sm text-muted-foreground">Scanning...</p> : null}
            {discoverError ? (
              <p className="text-sm text-destructive">{discoverError.message}</p>
            ) : null}
            {!isDiscovering && discovered.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No skill folders found. Add directories with SKILL.md under one of:{' '}
                {DISCOVERY_DIR_LABEL}.
              </p>
            ) : null}

            <div className="max-h-[28rem] overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
              {discovered.map((item) => {
                const key = discoveryKey(item);
                const checked = selectedDiscoveryKeys.has(key);
                return (
                  <label
                    key={key}
                    className={cn(
                      'flex items-start gap-2 rounded-md border p-2 cursor-pointer',
                      checked ? 'border-primary/50 bg-primary/5' : 'border-border',
                    )}
                  >
                    {canManage ? (
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleDiscovery(item)}
                        className="mt-0.5"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{item.name}</span>
                        {item.imported ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Imported
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            New
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{item.relativePath}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.fileCount} file{item.fileCount === 1 ? '' : 's'}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>

            {canManage && discovered.length > 0 ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleImportSelected}
                  disabled={selectedDiscoveryKeys.size === 0 || importDiscoveredMutation.isPending}
                >
                  Import selected
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleImportAllNew}
                  disabled={notImported.length === 0 || importDiscoveredMutation.isPending}
                >
                  Import all new ({notImported.length})
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Library</CardTitle>
            <CardDescription>Org-scoped skills available to agent nodes.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
            {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
            {!isLoading && skills.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No skills imported yet. Use workspace discovery or import a zip above.
              </p>
            ) : null}
            {skills.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {skills.map((skill) => (
                  <div
                    key={skill.id}
                    className="flex items-start justify-between gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{skill.name}</div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs text-muted-foreground">{skill.slug}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {skill.fileCount} file{skill.fileCount === 1 ? '' : 's'}
                        </Badge>
                        {!skill.enabled ? (
                          <Badge variant="outline" className="text-[10px]">
                            Disabled
                          </Badge>
                        ) : null}
                      </div>
                      {skill.description ? (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {skill.description}
                        </p>
                      ) : null}
                    </div>
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${skill.name}`}
                        onClick={() => void handleDelete(skill.id, skill.name)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
