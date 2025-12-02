SELECT DISTINCT
  bnpl_ledger.partner_name AS "PARTNER_NAME",
  bnpl_ledger.customer_name AS "CUSTOMER_NAME",
  CAST(bnpl_ledger.invoice_number AS String) AS "INVOICE_NUMBER",
  bnpl_ledger.invoice_external_number AS "INVOICE_EXTERNAL_NUMBER",
  bnpl_ledger.transaction_timestamp AS "TRANSACTION_TIMESTAMP",
  bnpl_ledger.transaction_status AS "TRANSACTION_STATUS",
  bnpl_ledger.bnpl_ledger_id AS "PAYMENT_ID",
  bnpl_ledger.payment_trigger AS "PAYMENT_TRIGGER",
  bnpl_ledger.payment_amount AS "PAYMENT_AMOUNT",
  bnpl_ledger.payment_net_amount AS "PAYMENT_NET_AMOUNT",
  bnpl_ledger.partner_id AS "PARTNER_ID",
  bnpl_ledger.customer_id AS "CUSTOMER_ID",
  "Svb Return Codes".created_at AS "Svb Return Codes__return_code_created_at",
  "Svb Return Codes".status AS "Svb Return Codes__return_code",
  "Svb Return Codes".reason AS "Svb Return Codes__transaction_failure_reason"
FROM
  gold.bnpl_ledger AS bnpl_ledger
LEFT JOIN default.alt_directpayment_direct_payment_status AS "Svb Return Codes" ON bnpl_ledger.bnpl_ledger_id = "Svb Return Codes".direct_payment_direct_payment_status
WHERE
  (bnpl_ledger.transaction_status = 'chargeback')
   AND (bnpl_ledger.payment_method = 'ach')
ORDER BY
  "Svb Return Codes".created_at DESC
LIMIT 1048575
