import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { WebhookFormState } from './webhookEditorTypes';

interface WebhookSettingsTabProps {
  form: WebhookFormState;
  onDescriptionChange: (description: string) => void;
  onDelete: () => void;
}

export function WebhookSettingsTab({
  form,
  onDescriptionChange,
  onDelete,
}: WebhookSettingsTabProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>General Settings</CardTitle>
          <CardDescription>Configure basic webhook details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhook-description">Description</Label>
            <Textarea
              id="webhook-description"
              value={form.description}
              onChange={(e) => onDescriptionChange(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>Destructive actions.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={onDelete} className="gap-2">
            <Trash2 className="h-4 w-4" /> Delete Webhook
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
