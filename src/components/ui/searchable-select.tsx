'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const filteredOptions = React.useMemo(() => {
    if (!search) return options;
    const lowerSearch = search.toLowerCase();
    return options.filter((option) =>
      option.toLowerCase().includes(lowerSearch)
    );
  }, [options, search]);

  const handleSelect = (selectedValue: string) => {
    onValueChange(selectedValue);
    setOpen(false);
    setSearch('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('justify-between font-medium', className)}
        >
          {value || placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto p-1">
          {filteredOptions.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No results found
            </div>
          ) : (
            filteredOptions.map((option) => (
              <button
                key={option}
                onClick={() => handleSelect(option)}
                className={cn(
                  'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 px-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                  value === option && 'bg-accent'
                )}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4',
                    value === option ? 'opacity-100' : 'opacity-0'
                  )}
                />
                {option}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
