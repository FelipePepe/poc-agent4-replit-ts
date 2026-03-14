# Git Workflow — GitFlow

Este proyecto sigue GitFlow estricto. **Nunca se hacen commits directos a `main` ni a `develop`** — los hooks de Husky lo bloquean.

---

## Ramas permanentes

| Rama | Propósito |
|------|-----------|
| `main` | Código en producción. Solo recibe merges desde `release/*` o `hotfix/*`. |
| `develop` | Integración continua. Recibe merges desde `feature/*` y `release/*`. |

## Ramas temporales

| Prefijo | Desde | Hacia | Propósito |
|---------|-------|-------|-----------|
| `feature/*` | `develop` | `develop` | Nueva funcionalidad |
| `release/*` | `develop` | `main` + `develop` | Preparación de release |
| `hotfix/*` | `main` | `main` + `develop` | Fix urgente en producción |

---

## Flujo de feature

```
develop
  └── feature/mi-feature
        │
        ├── commits (TDD: red → green → refactor)
        │
        └── PR → develop (code review + CI)
```

```bash
git checkout develop
git checkout -b feature/mi-feature

# ... commits con Conventional Commits ...

gh pr create --base develop --head feature/mi-feature
gh pr merge <id> --merge
```

---

## Flujo de release (feature → develop → main)

```
develop
  └── release/v1.0.0
        │
        ├── bump version, CHANGELOG, last fixes
        │
        ├── PR → main   (review final)
        │     └── merge → tag v1.0.0
        │
        └── PR → develop  (back-merge para sincronizar tag)
```

```bash
# 1. Crear rama release desde develop
git checkout develop
git checkout -b release/v1.0.0

# 2. Ajustes finales (version bump en package.json, CHANGELOG)
# ... commits ...

# 3. PR release → main
gh pr create --base main --head release/v1.0.0 \
  --title "release: v1.0.0" \
  --body "Release v1.0.0 — descripción de cambios"

# 4. Merge y tag
gh pr merge <id> --merge
git checkout main && git pull
git tag -a v1.0.0 -m "release: v1.0.0"
git push origin v1.0.0

# 5. Back-merge main → develop
git checkout develop
git merge --no-ff main -m "chore(release): back-merge v1.0.0 into develop"
git push origin develop

# 6. Eliminar rama release
git branch -d release/v1.0.0
git push origin --delete release/v1.0.0
```

---

## Flujo de hotfix

```bash
git checkout main
git checkout -b hotfix/fix-critico

# ... fix + tests ...

# PR → main
gh pr create --base main --head hotfix/fix-critico
gh pr merge <id> --merge

# Tag patch
git checkout main && git pull
git tag -a v1.0.1 -m "hotfix: fix-critico"
git push origin v1.0.1

# Back-merge a develop
git checkout develop
git merge --no-ff main -m "chore(hotfix): back-merge v1.0.1 into develop"
git push origin develop
```

---

## Convenciones de commits

Se usa [Conventional Commits](https://www.conventionalcommits.org/). Ejemplos:

```
feat(agents): add PlannerAgent with subtask decomposition
fix(db): correct WAL checkpoint on connection close
docs(readme): add GitFlow section
chore(release): back-merge v1.0.0 into develop
```

El hook `commit-msg` (Husky) rechaza mensajes que no cumplan el formato.

---

## Ramas protegidas

`main` y `develop` están protegidas por el hook `pre-commit` (`check_protected_branch.ts`). Ningún commit directo es posible — todo cambio entra vía PR.
