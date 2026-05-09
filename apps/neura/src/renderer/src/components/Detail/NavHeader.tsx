// /components/Header.tsx
import { Button } from '@renderer/components/ui/button';
import { ChevronLeft, FileText } from 'lucide-react';
interface HeaderProps {
  title: string;
  onBack: () => void;
  docUrl?: string;
  children?: React.ReactNode;
}

export function NavHeader({ title, onBack, docUrl, children }: HeaderProps) {
  return (
    <div className="draggable-area flex items-center gap-2 px-5 py-3">
      <Button
        variant="ghost"
        size="sm"
        className="rounded-full !pl-1 pr-4 text-white/90 hover:bg-white/8 hover:text-white"
        style={{ '-webkit-app-region': 'no-drag' }}
        onClick={onBack}
      >
        <ChevronLeft strokeWidth={2} className="!h-5 !w-5" />
        <span className="font-semibold">{title}</span>
      </Button>

      <div className="flex-1 flex justify-end gap-2">{children}</div>

      {!!docUrl && (
        <Button
          variant="outline"
          className="size-9 rounded-xl border-white/10 bg-white/7 hover:bg-white/12"
          size="sm"
          style={{ '-webkit-app-region': 'no-drag' }}
          onClick={() => window.open(docUrl, '_blank')}
        >
          <FileText strokeWidth={2} />
        </Button>
      )}
    </div>
  );
}
