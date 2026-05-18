import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect } from 'react';
import { SELECTION_CHANGE_COMMAND, COMMAND_PRIORITY_LOW } from 'lexical';

interface CagedScrollPluginProps {
  scrollerRef: React.RefObject<HTMLElement>;
  topBoundaryPx: number;
  bottomBoundaryPx: number;
}

export function CagedScrollPlugin({ scrollerRef, topBoundaryPx, bottomBoundaryPx }: CagedScrollPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // We register a listener for off-screen selection changes
    const checkScroll = () => {
      const scroller = scrollerRef.current;
      if (!scroller) return false;

      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) return false;

      const range = domSelection.getRangeAt(0);
      const caretRect = range.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();

      // If the selection has no width/height, it might be an empty line / unmeasurable.
      if (caretRect.height === 0 && caretRect.width === 0) {
        return false;
      }

      // Calculate absolute positions relative to the viewport
      const caretTop = caretRect.top;
      const caretBottom = caretRect.bottom;

      const cageTop = scrollerRect.top + topBoundaryPx;
      const cageBottom = scrollerRect.bottom - bottomBoundaryPx;

      let targetScrollTop = scroller.scrollTop;

      if (caretTop < cageTop) {
        // Caret went above the cage, scroll up!
        const difference = cageTop - caretTop;
        targetScrollTop -= difference;
      } else if (caretBottom > cageBottom) {
        // Caret went below the cage, scroll down!
        const difference = caretBottom - cageBottom;
        targetScrollTop += difference;
      }

      if (targetScrollTop !== scroller.scrollTop) {
        // Use 'auto' instead of 'smooth' to prevent fighting with 
        // the browser's native scroll-to-caret speed. We instantly clamp it.
        scroller.scrollTo({
          top: targetScrollTop,
          behavior: 'auto',
        });
      }

      return false; // Don't stop command propagation
    };

    const removeUpdateListener = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        // Defer to allow the DOM to paint the new lines
        setTimeout(checkScroll, 0);
      });
    });

    const removeSelectionListener = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        // Defer selection scroll checks as well
        setTimeout(checkScroll, 0);
        return false;
      },
      COMMAND_PRIORITY_LOW
    );

    return () => {
      removeUpdateListener();
      removeSelectionListener();
    };
  }, [editor, scrollerRef, topBoundaryPx, bottomBoundaryPx]);

  return null;
}

