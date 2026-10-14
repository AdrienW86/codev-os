# Conversation vocale continue

Le bouton micro principal de l'assistant démarre désormais le mode conversation continue, plutôt que la dictée à usage unique. Un second clic arrête la session. Après chaque demande, le micro est fermé pendant la transcription, l'exécution et la réponse vocale, puis réouvert si la session et l'onglet restent actifs.

## Limites connues

- Fonctionne lorsque le navigateur autorise MediaRecorder, AudioContext, la synthèse vocale et que la transcription serveur est configurée.
- Lorsqu'une commande change de page et démonte le composant de l'assistant, la session s'arrête. Un assistant vocal persistant dans le layout sera nécessaire pour naviguer entre les écrans sans réactiver le micro.
- Une transcription vide, une erreur API ou l'onglet masqué peut terminer la session. Le mode dictée ponctuelle reste accessible par les autres interfaces qui utilisent useVoice.toggle.
- Ne fonctionne pas lorsque l'onglet est en arrière-plan ou le téléphone verrouillé.

Valider manuellement avec autorisation microphone sur Chrome : ouvrir l'accueil, cliquer le micro, parler deux fois avec pause entre les deux demandes, arrêter, et vérifier que le micro ne capture pas la synthèse vocale.
