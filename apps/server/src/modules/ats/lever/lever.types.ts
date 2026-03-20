export interface LeverCategories {
  location?: string;
}

export interface LeverJob {
  text?: string;
  descriptionPlain?: string;
  description?: string;
  categories?: LeverCategories;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
}

