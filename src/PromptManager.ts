import {
  addOpenPromptChangeListener,
  readOpenPrompts,
  removeOpenPromptChangeListener,
  updateOpenPrompts
} from './storage';
import { OpenPromptItem } from './types';

export default {
  add: async (item: OpenPromptItem) => {
    const openPrompts = (await readOpenPrompts()) ?? [];
    openPrompts.push(item);
    return await updateOpenPrompts(openPrompts);
  },
  get: async () => {
    return await readOpenPrompts();
  },
  remove: async (id: string) => {
    const openPrompts = (await readOpenPrompts()) ?? [];
    return await updateOpenPrompts(openPrompts.filter(item => item.id !== id));
  },
  addChangeListener: async (
    callback: (newOpenPrompts: OpenPromptItem[]) => void
  ) => {
    await addOpenPromptChangeListener(callback);
  },
  removeChangeListener: async (
    listener: (newOpenPrompts: OpenPromptItem[]) => void
  ) => {
    await removeOpenPromptChangeListener(listener);
  }
};
