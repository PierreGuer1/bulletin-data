# bulletin-data

Dépôt **public** de données pour [Bulletin](https://bulletin-eja.pages.dev)
(l'app elle-même vit dans un dépôt privé). Il existe pour une seule raison :
`raw.githubusercontent.com` — le seul maillon gratuit, sans serveur et
CORS-ouvert de la chaîne — ne sert que les dépôts publics.

## Ce qu'il contient

- `scripts/build-vigilance.mjs` : relève la vigilance météo Météo-France
  (rediffusée par MeteoAlarm/EUMETNET, sans clé) et la compacte en un JSON par
  département.
- `.github/workflows/vigilance.yml` : l'exécute toutes les 30 minutes,
  relève aussi le GeoJSON de vigilance crues Vigicrues (simple miroir —
  Vigicrues a retiré son CORS le 2026-08-09), et publie le tout sur la
  branche **`vigilance-data`**, réécrite d'un commit unique à chaque tour —
  donnée périssable, historique sans intérêt.

## Ce qu'il sert

```
https://raw.githubusercontent.com/PierreGuer1/bulletin-data/vigilance-data/vigilance.json
https://raw.githubusercontent.com/PierreGuer1/bulletin-data/vigilance-data/InfoVigiCru.geojson
```

`vigilance.json` : `{ generatedAt, source, byDept: { "49": [{ phenomene,
niveau, couleur, debut, fin }] } }`. L'app juge la fraîcheur via `generatedAt`
et annonce « non vérifiée » au-delà de 24 h — si le workflow meurt, rien ne
casse, l'information se dégrade honnêtement.

`InfoVigiCru.geojson` : le fichier national Vigicrues tel quel (tronçons de
cours d'eau surveillés + niveau de vigilance crues).

Aucune donnée personnelle : ce sont les vigilances publiques de Météo-France
et de Vigicrues.
