-- GoBD Compliance: Prevent modification or deletion of invoices
-- Rechnungen dürfen nach deutschem Recht nicht geändert oder gelöscht werden

CREATE OR REPLACE FUNCTION prevent_invoice_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'GoBD: Invoices cannot be modified or deleted';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Block UPDATE on invoices that already have a PDF (finalized)
DROP TRIGGER IF EXISTS invoices_immutable_update ON invoices;
CREATE TRIGGER invoices_immutable_update
BEFORE UPDATE ON invoices
FOR EACH ROW
WHEN (OLD.pdf_url IS NOT NULL)
EXECUTE FUNCTION prevent_invoice_modification();

-- Block DELETE on all invoices
DROP TRIGGER IF EXISTS invoices_immutable_delete ON invoices;
CREATE TRIGGER invoices_immutable_delete
BEFORE DELETE ON invoices
FOR EACH ROW
EXECUTE FUNCTION prevent_invoice_modification();
