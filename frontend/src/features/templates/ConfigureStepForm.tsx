import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DialogFooter } from '@/components/ui/dialog';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TEMPLATE_CATEGORIES, COMMON_TAGS } from './publish-template-types';

interface ConfigureStepFormProps {
  name: string;
  onNameChange: (name: string) => void;
  description: string;
  onDescriptionChange: (description: string) => void;
  category: string;
  onCategoryChange: (category: string) => void;
  tags: string[];
  tagInput: string;
  onTagInputChange: (input: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  onAddCommonTag: (tag: string) => void;
  author: string;
  onAuthorChange: (author: string) => void;
  error: string | null;
  isLoading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function ConfigureStepForm({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  category,
  onCategoryChange,
  tags,
  tagInput,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
  onAddCommonTag,
  author,
  onAuthorChange,
  error,
  isLoading,
  onSubmit,
  onClose,
}: ConfigureStepFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Template Name */}
      <div className="space-y-2">
        <Label htmlFor="template-name">Template Name *</Label>
        <Input
          id="template-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="My Security Template"
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Describe what this template does..."
          rows={3}
        />
      </div>

      {/* Category */}
      <div className="space-y-2">
        <Label htmlFor="category">Category *</Label>
        <Select value={category} onValueChange={onCategoryChange}>
          <SelectTrigger id="category">
            <SelectValue placeholder="Select a category" />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat.toLowerCase()}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <Label>Tags</Label>
        <div className="flex gap-2">
          <Input
            value={tagInput}
            onChange={(e) => onTagInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAddTag();
              }
            }}
            placeholder="Add a tag..."
          />
          <Button type="button" variant="outline" onClick={onAddTag}>
            Add
          </Button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1">
                {tag}
                <X className="h-3 w-3 cursor-pointer" onClick={() => onRemoveTag(tag)} />
              </Badge>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1 mt-2">
          {COMMON_TAGS.slice(0, 8).map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className={cn(
                'cursor-pointer',
                tags.includes(tag) && 'bg-primary text-primary-foreground',
              )}
              onClick={() => onAddCommonTag(tag)}
            >
              + {tag}
            </Badge>
          ))}
        </div>
      </div>

      {/* Author */}
      <div className="space-y-2">
        <Label htmlFor="author">Author / Organization *</Label>
        <Input
          id="author"
          value={author}
          onChange={(e) => onAuthorChange(e.target.value)}
          placeholder="Your name or organization"
        />
      </div>

      {/* Info Box */}
      <div className="p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
        <p>
          <strong>Note:</strong> Your workflow will be sanitized before publishing. All secret
          references will be removed and replaced with placeholders. Clicking &ldquo;Next&rdquo;
          will generate a preview for your review.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/50">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading} className="gap-2">
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          Next: Review
        </Button>
      </DialogFooter>
    </form>
  );
}
