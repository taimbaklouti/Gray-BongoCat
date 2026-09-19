# Étape 2 : Adoucissement des bordures de la table et du Chat  
   
La structure globale de la fenêtre étant en place, nous allons ajuster l'affichage du chat et de sa table pour adoucir les angles droits (*sharp*).  
   
## Remarque importante sur l'overlay :  
L'overlay principal du chat doit rester sur fond transparent (sans le fond quadrillé gingham), mais les éléments du chat/table doivent avoir leurs coins adoucis.  
   
## Tâches à réaliser :  
1. **Masque / Arrondi du chat et de la table :**  
   - Localise les composants Vue gérant le rendu de la table et du chat (`src/views/main/index.vue` ou composants associés).  
   - Applique un `border-radius` léger (ex: `6px` à `8px`) ou un masque de découpe CSS (*clip-path* / *overflow: hidden*) sur le conteneur de la table et du personnage.  
   - S'assurer que les sprites et calques du chat (pattes, clavier, souris) restent bien cadrés sans être rognés lors des animations.  
   
2. **Ajustement du fond de l'overlay :**  
   - Retire la classe du fond quadrillé `pixel-gingham` de la fenêtre principale `main/index.vue` afin d'avoir uniquement le chat/table flottant sur le bureau.  
   
3. **Vérification :**  
-    - Lance `pnpm build:vite` et vérifie qu'il n'y a pas d'erreurs de build.  
