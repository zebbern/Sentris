import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Home, ArrowLeft } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export function NotFound() {
  useDocumentTitle('Not Found');
  const navigate = useNavigate();

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto px-3 md:px-4 flex items-center justify-center min-h-[60vh]">
        <div className="max-w-md mx-auto text-center">
          <p
            aria-hidden="true"
            className="text-7xl md:text-9xl font-bold text-muted-foreground/20 mb-4 select-none"
          >
            404
          </p>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Page Not Found</h1>
          <p className="text-muted-foreground mb-8">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button onClick={() => navigate('/')} className="gap-2">
              <Home className="h-4 w-4" />
              Go to Homepage
            </Button>
            <Button onClick={() => navigate(-1)} variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Go Back
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
