import { Text, TextProps } from 'ink';
import * as React from 'react';

interface ProgressBarProps extends TextProps {
  columns: number;
  percent: number;
  left: number;
  right: number;
  character: string;
  rightPad: boolean;
  width: number;
  incompleteChar: string;
}

export function ProgressBar(props: ProgressBarProps) {
  const {
    percent,
    columns,
    left,
    right,
    character,
    rightPad,
    width,
    incompleteChar,
    ...forwardedPropsForText
  } = props;

  let content = '';
  const screen = width || columns || process.stdout.columns || 80;
  const space = screen - right - left;
  const max = Math.min(Math.floor(space * percent), space);
  const chars = character.repeat(max);

  if (!rightPad) {
    content = chars;
  } else {
    content = chars + incompleteChar.repeat(space - max);
  }

  return <Text {...forwardedPropsForText}>{content}</Text>;
}

ProgressBar.defaultProps = {
  columns: 0,
  percent: 1,
  left: 0,
  right: 0,
  character: '█',
  rightPad: false,
};
