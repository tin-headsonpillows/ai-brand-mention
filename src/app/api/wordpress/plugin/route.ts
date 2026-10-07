import { strToU8, zipSync } from "fflate";

const PLUGIN = `<?php
/**
 * Plugin Name: AI Brand Mention Tracker - SEO meta bridge
 * Description: Lets the AI Brand Mention Tracker set the Yoast SEO / Rank Math SEO title, meta description and focus keyword through the WordPress REST API. Only users who can edit a post can change its values.
 * Version: 1.0.0
 * Requires at least: 5.6
 * Requires PHP: 7.0
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('init', function () {
    $keys = array(
        '_yoast_wpseo_title',
        '_yoast_wpseo_metadesc',
        '_yoast_wpseo_focuskw',
        'rank_math_title',
        'rank_math_description',
        'rank_math_focus_keyword',
    );
    foreach (array('post', 'page') as $post_type) {
        foreach ($keys as $key) {
            register_post_meta($post_type, $key, array(
                'type' => 'string',
                'single' => true,
                'show_in_rest' => true,
                'sanitize_callback' => 'sanitize_text_field',
                'auth_callback' => function ($allowed, $meta_key, $post_id) {
                    return current_user_can('edit_post', $post_id);
                },
            ));
        }
    }
});

add_action('rest_api_init', function () {
    register_rest_route('abmt/v1', '/ping', array(
        'methods' => 'GET',
        'callback' => function () {
            return array('plugin' => 'ai-brand-mention-seo-bridge', 'version' => '1.0.0');
        },
        'permission_callback' => '__return_true',
    ));
});
`;

/** The helper plugin as a .zip, ready for Plugins -> Add New -> Upload Plugin. */
export async function GET() {
  const zip = zipSync({ "ai-brand-mention-seo-bridge/ai-brand-mention-seo-bridge.php": strToU8(PLUGIN) });
  return new Response(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="ai-brand-mention-seo-bridge.zip"',
    },
  });
}
