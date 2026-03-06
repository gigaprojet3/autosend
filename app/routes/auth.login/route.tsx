import { AppProvider as PolarisAppProvider, Page, Card, FormLayout, TextField, Button, Text } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <PolarisAppProvider i18n={polarisTranslations}>
      <Page>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text as="h2" variant="headingMd">Log in</Text>
              <TextField
                type="text"
                name="shop"
                label="Shop domain"
                helpText="example.myshopify.com"
                value={shop}
                onChange={(value) => setShop(value)}
                autoComplete="on"
                error={errors.shop}
              />
              <Button submit variant="primary">Log in</Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
