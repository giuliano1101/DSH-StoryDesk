// Browser-safe: use exactly the same identity for pending requests and history.
// Selection and the currently configured persona deliberately do not split chats.
export function assistantContextKey(context) {
  const identity = [context.page, context.projectId || null, context.sceneId || null, context.focus?.kind || null, context.focus?.id || null];
  if (context.creationMode === 'novel') identity.push('novel');
  else if (context.episodeId) identity.push('episode', context.episodeId);
  return JSON.stringify(identity);
}
