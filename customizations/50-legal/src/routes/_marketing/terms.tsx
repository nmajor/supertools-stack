// Terms of Service — operative template shipped by the 50-legal install step.
//
// This file overwrites 30-marketing's empty terms placeholder. Placeholder
// strings of the form {{KEY}} ship verbatim in the rendered project (this is
// NOT a .tmpl file, so render.mjs does not process it). The deployer fills
// them in at install time / a later supertools-design step.
//
// Allowed placeholders (do not introduce others):
//   {{COMPANY_LEGAL_NAME}}  {{PRODUCT_NAME}}  {{DOMAIN}}
//   {{MOR_NAME}}  {{JURISDICTION}}  {{EFFECTIVE_DATE}}
import { createFileRoute } from '@tanstack/react-router';
import { seoHead } from '../../components/SeoHead';

export const Route = createFileRoute('/_marketing/terms')({
  component: TermsPage,
  head: () => seoHead({ title: 'Terms' }),
});

function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 prose prose-slate">
      <h1>Terms of Service</h1>
      <p className="text-sm text-gray-500">
        Last updated: {`{{EFFECTIVE_DATE}}`}
      </p>

      <h2>1. Introduction and acceptance</h2>
      <p>
        These Terms of Service (the &ldquo;Terms&rdquo;) govern your access to
        and use of {`{{PRODUCT_NAME}}`} (the &ldquo;Service&rdquo;), operated
        by {`{{COMPANY_LEGAL_NAME}}`} (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or
        &ldquo;our&rdquo;). By creating an account or using the Service, you
        agree to these Terms and to our Privacy Policy, which is incorporated
        here by reference. If you do not agree, do not use the Service.
      </p>

      <h2>2. Account and eligibility</h2>
      <p>
        You must be old enough to form a binding contract in your
        jurisdiction to use the Service. The Service is not directed at
        children, and accounts associated with users under the age of 13
        (United States) or under 16 (European Union) are subject to deletion
        as described in our Privacy Policy. You may hold one account per
        person. You are responsible for keeping your credentials secure and
        for all activity that occurs under your account. Notify us promptly
        if you suspect unauthorized access.
      </p>

      <h2>3. Acceptable use</h2>
      <p>
        You agree not to use the Service to engage in unlawful, abusive, or
        harmful conduct; to send spam or malware; to infringe the rights of
        others; to attempt to gain unauthorized access to any system; or to
        scrape, reverse-engineer, or otherwise circumvent the Service&rsquo;s
        technical limits. We may suspend or terminate accounts that violate
        these rules, with or without notice depending on the severity.
      </p>

      <h2>4. Subscription, billing, and refunds</h2>
      <p>
        Paid plans are sold and billed by {`{{MOR_NAME}}`} acting as our
        Merchant of Record. {`{{MOR_NAME}}`} is the seller of record for tax
        purposes and is responsible for charging applicable taxes (including
        VAT and sales tax), processing payments, issuing receipts, and
        handling refunds and statutory cooling-off rights in accordance with
        its policies and applicable law. Your purchase contract for paid
        features is with {`{{MOR_NAME}}`}; your service contract for the
        Service itself is with us under these Terms.
      </p>
      <p>
        You can cancel your subscription at any time from your account
        settings or via {`{{MOR_NAME}}`}. Cancellation stops future renewals;
        your access continues through the end of the period you have already
        paid for. Refund eligibility is governed by {`{{MOR_NAME}}`}&rsquo;s
        published policies and by any non-waivable consumer rights you have
        under your local law.
      </p>

      <h2>5. Intellectual property</h2>
      <p>
        We retain all rights, title, and interest in the Service, including
        the software, design, branding, and documentation. You retain all
        rights to the content and data you submit to the Service (&ldquo;Your
        Content&rdquo;). You grant us a limited, worldwide, royalty-free
        license to host, store, transmit, and display Your Content solely as
        necessary to operate and provide the Service to you. We do not claim
        ownership of Your Content, and we do not use Your Content to train
        AI models. See our Privacy Policy for details.
      </p>

      <h2>6. Termination and account deletion</h2>
      <p>
        You may delete your account at any time from the settings page. When
        you delete your account, we remove your account record and cascade-
        delete the data associated with it within 30 days, subject to narrow
        exceptions for backups, legal-hold obligations, and aggregated or
        anonymized data that no longer identifies you. We may also suspend
        or terminate your account if you materially breach these Terms. On
        termination, the rights you have under these Terms end, but the
        sections that by their nature should survive (intellectual property,
        disclaimers, limitation of liability, governing law, and these
        survival provisions) will continue in force.
      </p>

      <h2>7. Disclaimers and limitation of liability</h2>
      <p>
        The Service is provided &ldquo;as is&rdquo; and &ldquo;as
        available,&rdquo; without warranties of any kind, express or implied,
        including warranties of merchantability, fitness for a particular
        purpose, non-infringement, or uninterrupted operation. We do not
        warrant that the Service will be error-free, that defects will be
        corrected, or that the Service or its servers are free of harmful
        components.
      </p>
      <p>
        To the maximum extent permitted by applicable law, our aggregate
        liability arising out of or relating to the Service or these Terms
        will not exceed the greater of (a) the amount you paid for the
        Service in the twelve months immediately preceding the event giving
        rise to the claim, or (b) one hundred United States dollars (USD
        $100). In no event will we be liable for indirect, incidental,
        special, consequential, exemplary, or punitive damages, or for lost
        profits, lost revenue, or lost data, even if advised of the
        possibility of such damages. Some jurisdictions do not allow these
        limitations; in those jurisdictions, our liability is limited to the
        smallest extent permitted by law.
      </p>

      <h2>8. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. If we make material
        changes, we will notify you by email or through an in-product notice
        at least a reasonable period before the change takes effect. Your
        continued use of the Service after the effective date of an updated
        version constitutes acceptance of the new Terms. If you do not
        agree, you may stop using the Service and delete your account.
      </p>

      <h2>9. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of {`{{JURISDICTION}}`},
        without regard to its conflict-of-laws rules. Before bringing a
        formal claim, you agree to first contact us and attempt to resolve
        the dispute informally for at least sixty (60) days. If we cannot
        resolve the dispute informally, any claim must be brought in the
        courts located in {`{{JURISDICTION}}`}, and you and we consent to
        the personal jurisdiction of those courts. Nothing in this section
        limits any non-waivable consumer rights you have under the law of
        your country of residence.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about these Terms can be sent to{' '}
        <a href={`mailto:privacy@{{DOMAIN}}`}>privacy@{`{{DOMAIN}}`}</a> or
        through our <a href="/contact">contact form</a>.
      </p>
      {/* TODO: add postal address before launch in regulated jurisdictions */}
    </div>
  );
}
