# SQLModel package layout research

Date: 2026-08-12

## Question

Should Animichi place SQLModel mappings in an `entities` package, or use a
database/infrastructure-oriented name?

## Primary-source findings

1. SQLModel calls a class declared with `table=True` a **table model**. It
   distinguishes table models from data models used for create/public/update
   schemas. It does not prescribe calling mapped classes domain entities.
   - https://sqlmodel.tiangolo.com/tutorial/fastapi/multiple-models/

2. SQLModel's project-layout example uses `models.py` for model declarations
   and `db.py` for the engine. It also recommends a single application engine
   and separately scoped sessions.
   - https://sqlmodel.tiangolo.com/tutorial/create-db-and-table/

3. FastAPI's official full-stack template uses `app/models.py`, `app/crud.py`,
   and `app/core/db.py`. This is a compact application convention, not a rule
   that persistence classes belong in a domain `entities` module.
   - https://github.com/fastapi/full-stack-fastapi-template/blob/master/backend/README.md

4. SQLAlchemy's official terminology is **mapped class**, **declarative
   model**, and **mapping**. Declarative mapping is the primary mapping style.
   - https://docs.sqlalchemy.org/en/20/orm/declarative_mapping.html
   - https://docs.sqlalchemy.org/en/20/orm/declarative_styles.html

## Animichi-specific conclusion

Animichi already has `animichi.domain.entities`. Reusing `entities` for
SQLModel table mappings would collapse the domain and persistence vocabularies.
The ORM classes should remain infrastructure-owned.

Recommended layout:

```text
animichi/
  domain/
    entities.py             # persistence-independent domain concepts
    ports.py
  infrastructure/
    persistence/
      database.py           # async engine and session factory
      models/               # SQLModel table mappings
      repositories/         # implementations of application/domain ports
```

Use singular model names (`SessionRow` is unnecessary if `SessionModel` is
clear in context) and keep API request/response schemas under the interface
boundary. Atlas remains the schema authority; application startup must not call
`SQLModel.metadata.create_all()`.

`infrastructure/postgres` is also defensible, but `persistence` better names the
architectural responsibility and avoids coupling the package name to either a
hosting vendor or a database engine. PostgreSQL-specific expressions may remain
inside repository implementations.
