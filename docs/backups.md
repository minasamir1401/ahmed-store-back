# Store backups

Both `/api/admin/backup?type=data` and `?type=full` export every scalar field and every record of the store's Prisma models from one PostgreSQL repeatable-read snapshot. A missing model or failed table query fails the request instead of silently creating an incomplete archive. Log tables are no longer truncated.

The ZIP contains:

- `database.json`: the complete database payload used for restoration.
- `tables/product.json`: all product fields, including descriptions, prices, translations, image links, SEO, ingredients, supplement facts, FAQs and dosage configuration.
- `tables/<model>.json`: a readable JSON file for each database table.
- `manifest.json`: record counts, field names, paths and archive metadata. It is an index, not the records themselves.
- `README.txt`: Arabic instructions for opening the records and restoring the original ZIP.
- `uploads/`: uploaded media, included only in full backups. External images remain links in the database.

The admin download uses the Authorization header and checks the HTTP status, media type and ZIP signature before saving a file. Generation failures are displayed to the admin. The loading indicator remains active until the file has been received.

Restore accepts older ZIPs containing the required `database.json` table arrays. When a manifest exists, its counts must match the payload before restoration starts. Product fields, zero-valued prices/discounts, order-to-user links, audit records and revoked-token records are preserved.

Run `npm test` for ZIP export, full-media export, failure handling, rich-product restoration and incomplete-file validation. Tests use synthetic Prisma fixtures and temporary files; they do not connect to the production database.
