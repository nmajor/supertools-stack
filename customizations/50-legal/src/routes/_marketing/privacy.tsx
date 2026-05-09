// Privacy Policy — operative template shipped by the 50-legal install step.
//
// This file overwrites 30-marketing's empty privacy placeholder. Placeholder
// strings of the form {{KEY}} ship verbatim in the rendered project (this is
// NOT a .tmpl file, so render.mjs does not process it). The deployer fills
// them in at install time / a later supertools-design step.
//
// Allowed placeholders (do not introduce others):
//   {{COMPANY_LEGAL_NAME}}  {{PRODUCT_NAME}}  {{DOMAIN}}
//   {{EU_REPRESENTATIVE}}   {{MOR_NAME}}      {{EFFECTIVE_DATE}}
import { createFileRoute } from '@tanstack/react-router';
import { seoHead } from '../../components/SeoHead';

export const Route = createFileRoute('/_marketing/privacy')({
  component: PrivacyPage,
  head: () => seoHead({ title: 'Privacy' }),
});

function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 prose prose-slate">
      <h1>Privacy Policy</h1>
      <p className="text-sm text-gray-500">
        Last updated: {`{{EFFECTIVE_DATE}}`}
      </p>

      <h2>1. Introduction</h2>
      <p>
        This Privacy Policy explains how {`{{COMPANY_LEGAL_NAME}}`}{' '}
        (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) collects,
        uses, shares, and protects personal information when you use{' '}
        {`{{PRODUCT_NAME}}`} (the &ldquo;Service&rdquo;). It applies to the
        Service and to any related interactions you have with us, such as
        support requests sent to{' '}
        <a href={`mailto:privacy@{{DOMAIN}}`}>privacy@{`{{DOMAIN}}`}</a>. We
        write this policy in plain English; if anything is unclear, contact
        us and we will explain.
      </p>

      <h2>2. What we collect</h2>
      <p>
        We collect only the information needed to operate the Service:
      </p>
      <ul>
        <li>
          <strong>Account information.</strong> Your email address, your
          name (if you provide one), and a salted hash of your password. We
          never store passwords in plain text.
        </li>
        <li>
          <strong>Usage data.</strong> Basic logs of requests to the Service
          (timestamps, IP address, user agent, URL paths, response codes)
          for security, debugging, and capacity planning.
        </li>
        <li>
          <strong>Payment information.</strong> Payments are processed by{' '}
          {`{{MOR_NAME}}`} as our Merchant of Record. {`{{MOR_NAME}}`}{' '}
          collects and stores billing details, including card numbers; we
          receive only the information needed to provision your subscription
          (such as your subscription status and a {`{{MOR_NAME}}`} customer
          identifier). We do not store full card numbers on our systems.
        </li>
        <li>
          <strong>Communications.</strong> Messages you send us through the
          contact form, email, or in-product support channels, together
          with our replies.
        </li>
      </ul>

      <h2>3. How we use it</h2>
      <p>
        We use the information above to operate, maintain, and improve the
        Service: to authenticate you, to deliver the features you request,
        to communicate with you about your account (transactional messages
        only), to detect and prevent abuse, and to improve features in
        aggregated or anonymized form. We do not sell your personal
        information. We do not share it with advertisers, and we do not run
        third-party advertising on the Service.
      </p>

      <h2>4. What we do not do &mdash; AI training</h2>
      <p>
        <strong>
          We do not use customer data to train AI models.
        </strong>{' '}
        Your account information, the content you submit, your usage data,
        and your communications with us are not used to train, fine-tune,
        or otherwise improve any machine-learning model, whether ours or a
        third party&rsquo;s. Where the Service uses AI features powered by
        third-party providers, we configure those providers to disable
        training on customer data and we transmit only the data needed to
        return the result you asked for.
      </p>

      <h2>5. Sharing and subprocessors</h2>
      <p>
        We engage a small set of vendors (subprocessors) to operate the
        Service on our behalf. Each subprocessor is contractually bound to
        process personal data only on our instructions and to maintain
        appropriate security and confidentiality. The categories we use are:
      </p>
      <ul>
        <li>
          <strong>Hosting and infrastructure</strong> &mdash; serverless
          compute, edge networking, and managed databases that run the
          Service.
        </li>
        <li>
          <strong>Payment processing</strong> &mdash; {`{{MOR_NAME}}`}, our
          Merchant of Record, who handles billing, taxes, refunds, and
          related compliance.
        </li>
        <li>
          <strong>Transactional email</strong> &mdash; the provider that
          sends account-related email such as password resets and receipts.
        </li>
        <li>
          <strong>Product analytics</strong> &mdash; minimal first-party
          analytics that help us understand which features are used and
          where errors occur. No third-party advertising trackers.
        </li>
        <li>
          <strong>Customer support</strong> &mdash; the platform that
          receives and routes your support messages.
        </li>
      </ul>
      <p>
        We engage subprocessors as listed at our subprocessors page (link
        forthcoming). {/* TODO: link to /subprocessors page once published */}
      </p>

      <h2>6. Data retention and deletion</h2>
      <p>
        You can delete your account at any time from the settings page.
        When you do, we cascade-delete the rows associated with your
        account: every record that references your user identifier is
        removed automatically by a foreign-key constraint, with a default
        retention window of 30 days for any operational backups before
        those backups are recycled. We may retain a minimal record of the
        deletion event itself for security and audit purposes. You can
        request an export of your account data before deletion by writing
        to{' '}
        <a href={`mailto:privacy@{{DOMAIN}}`}>privacy@{`{{DOMAIN}}`}</a>.
      </p>

      <h2>7. Children</h2>
      <p>
        The Service is not directed at children. We do not knowingly
        collect personal information from children under the age of 13 in
        the United States or under the age of 16 in the European Union. If
        we learn that an account has been created by a child below those
        ages, we will close the account and delete the data associated
        with it. If you believe a child has registered, contact us at{' '}
        <a href={`mailto:privacy@{{DOMAIN}}`}>privacy@{`{{DOMAIN}}`}</a> so
        we can act promptly.
      </p>

      <h2>8. Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access the
        personal information we hold about you, to correct it, to delete
        it, to receive a portable copy of it, to restrict or object to
        certain processing, and to withdraw consent where we rely on
        consent. We honor these rights regardless of jurisdiction where
        we reasonably can. Exercising your rights is free, and we will not
        retaliate against you for doing so.
      </p>
      <p>
        For California residents, the two designated methods for submitting
        a privacy request under the CCPA/CPRA are: (a) email to{' '}
        <a href={`mailto:privacy@{{DOMAIN}}`}>privacy@{`{{DOMAIN}}`}</a>,
        and (b) our <a href="/contact">contact form</a> at /contact. We
        will verify your identity before fulfilling a request and will
        respond within the timelines required by law.
      </p>

      <h2>9. International users and EU representative</h2>
      <p>
        We operate the Service from outside the European Economic Area. If
        you are located in the EEA, the United Kingdom, or Switzerland and
        we process your personal data, you can contact our Article 27
        representative at: {`{{EU_REPRESENTATIVE}}`}.
      </p>
      {/* TODO: appoint EU rep if marketing to EU residents */}
      <p>
        Where we transfer personal data out of the EEA, the UK, or
        Switzerland, we rely on lawful transfer mechanisms such as the
        Standard Contractual Clauses and equivalent UK and Swiss addenda,
        together with supplementary measures where appropriate.
      </p>

      <h2>10. Cookies and similar technologies</h2>
      <p>
        We use a small number of cookies and similar technologies. Session
        cookies keep you signed in. A minimal first-party analytics cookie
        helps us understand product usage in aggregate. We do not run
        third-party advertising trackers. Most browsers let you block or
        delete cookies; doing so may prevent you from staying signed in.
      </p>

      <h2>11. Security</h2>
      <p>
        We take reasonable administrative, technical, and organizational
        measures to protect personal information, including password
        hashing, encryption in transit (HTTPS), access controls, and
        regular review of who can access production systems. No system is
        perfectly secure; if we become aware of a breach that affects your
        personal data, we will notify you and any required regulator in
        accordance with applicable law.
      </p>

      <h2>12. Changes to this Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. If we make
        material changes, we will notify you by email or through an
        in-product notice. Your continued use of the Service after the
        effective date of an updated policy constitutes acceptance of the
        new policy.
      </p>

      <h2>13. Contact</h2>
      <p>
        For privacy questions or requests, contact us at{' '}
        <a href={`mailto:privacy@{{DOMAIN}}`}>privacy@{`{{DOMAIN}}`}</a> or
        through our <a href="/contact">contact form</a>.
      </p>
      {/* TODO: add postal address before launch in regulated jurisdictions */}
    </div>
  );
}
