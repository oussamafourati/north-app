import { useParams } from "react-router";
import { apiFetch } from "../lib/api";
import { useQuery } from "@tanstack/react-query";

export default function useProductPage() {
  const { slug } = useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ["product", slug],
    queryFn: () => apiFetch(`/api/products/${slug}`),
    enabled: Boolean(slug),
  });

  return {
    slug,
    product: data?.product ?? null,
    isLoading,
    error,
  };
}
